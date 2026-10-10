/**
 * One pushed line as it is stored (#75; I2, I3, I9 of docs/decisions/2026-10-10-logs-tier.md).
 *
 * Every stored line carries a time no later than its receipt, because the reader stops on a file
 * whose modified time is older than the oldest line it kept (25 §25.3). A line with no `ts` gets
 * the receive time; a `ts` in the future is clamped and kept as `ingest.sent_ts`; a line that is
 * not a JSON object is wrapped as text, so it never joins the entry above it.
 */
import { jsonObjectSchema } from "@testate/shared";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { timeOf } from "../fields.ts";

export const DEFAULT_SOURCE = "default";

const SOURCE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

/** Whether a name may be a source folder: no leading dot, so never `.` or `..`. */
export const isSourceName = (name: string): boolean => SOURCE.test(name);

/** A `service.name` as a folder name: `[A-Za-z0-9._-]`, no leading dot, at most 64 characters. */
export function sourceName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\./, "_")
    .slice(0, 64);
  return cleaned === "" ? DEFAULT_SOURCE : cleaned;
}

export type StoredLine = { source: string; text: string; malformed: boolean };

const serviceSchema = v.object({ service: v.object({ name: v.string() }) });

function objectOf(raw: string): JsonObject | null {
  try {
    const parsed = v.safeParse(jsonObjectSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

/** The line with a time no later than `now`; the sent value kept when it had one. */
function stamped(object: JsonObject, now: number): JsonObject {
  const sent = timeOf(object["ts"]);
  if (sent !== null && sent <= now) return object;
  const received = new Date(now).toISOString();
  const original = object["ts"];
  return original === undefined
    ? { ...object, ts: received }
    : { ...object, ts: received, ingest: { sent_ts: original } };
}

export function storedLine(raw: string, now: number): StoredLine {
  const object = objectOf(raw);
  if (object === null) {
    const wrapped = {
      ts: new Date(now).toISOString(),
      level: "info",
      message: raw,
      ingest: { malformed: true },
    };
    return { source: DEFAULT_SOURCE, text: JSON.stringify(wrapped), malformed: true };
  }
  const service = v.safeParse(serviceSchema, object);
  return {
    source: service.success ? sourceName(service.output.service.name) : DEFAULT_SOURCE,
    text: JSON.stringify(stamped(object, now)),
    malformed: false,
  };
}
