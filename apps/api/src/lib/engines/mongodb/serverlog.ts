/**
 * MongoDB server logs (#84; D1 of docs/decisions/2026-10-10-db-server-logs.md). "Statements" is a
 * `currentOp` snapshot: every user's operations with `clusterMonitor`, this user's own without it.
 * "Server log" is `getLog: "global"`, the last 1024 lines the server keeps in memory.
 */
import { BSON } from "mongodb";
import type { Document } from "mongodb";
import type { JsonObject, LogLevel, ServerLogSource } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { pageWindow, withoutValues } from "../../logs/server.ts";
import type { ServerLogEntry, ServerLogPage, ServerLogRead } from "../types.ts";
import type { MongoHandle } from "./client.ts";

/** A stable id for a line or an operation with no id of its own, so follow never repeats it. */
const idOf = (text: string): string => Bun.hash(text).toString(16).padStart(16, "0");

const opSchema = v.object({
  inprog: v.array(
    v.looseObject({
      opid: v.optional(v.union([v.number(), v.string()])),
      op: v.optional(v.string()),
      ns: v.optional(v.string()),
      currentOpTime: v.optional(v.string()),
      microsecs_running: v.optional(v.union([v.number(), v.string()])),
      command: v.optional(v.record(v.string(), v.unknown())),
    })
  ),
});

/** A command's BSON values (ObjectId, Long, Date) as plain JSON, the way relaxed EJSON writes them. */
function plainJson(command: Document): JsonObject {
  return v.parse(jsonObjectSchema, JSON.parse(BSON.EJSON.stringify(command, { relaxed: true })));
}

/** Every user's operations when the role allows it, else this user's own (`$ownOps`). */
async function currentOps(handle: MongoHandle): Promise<v.InferOutput<typeof opSchema>> {
  try {
    return v.parse(opSchema, await handle.db.admin().command({ currentOp: 1 }));
  } catch {
    return v.parse(opSchema, await handle.db.admin().command({ currentOp: 1, $ownOps: true }));
  }
}

async function statements(handle: MongoHandle): Promise<ServerLogEntry[]> {
  const ops = await currentOps(handle);
  return ops.inprog
    .filter((op) => op.command !== undefined && op.command["currentOp"] === undefined)
    .map((op) => {
      const command = plainJson(op.command ?? {});
      const running = Number(op.microsecs_running ?? 0) / 1000;
      const now = op.currentOpTime === undefined ? Date.now() : Date.parse(op.currentOpTime);
      return {
        key: { time: now - running, id: idOf(String(op.opid ?? JSON.stringify(command))) },
        level: "info",
        message: JSON.stringify(command),
        digest: JSON.stringify(withoutValues(command)),
        fields: { opid: String(op.opid ?? ""), op: op.op ?? null, ns: op.ns ?? null },
      };
    });
}

const lineSchema = v.object({
  t: v.object({ $date: v.string() }),
  s: v.string(),
  c: v.optional(v.string()),
  id: v.optional(v.number()),
  ctx: v.optional(v.string()),
  msg: v.string(),
  attr: v.optional(jsonObjectSchema),
});
const SEVERITY = new Map<string, LogLevel>([
  ["F", "fatal"],
  ["E", "error"],
  ["W", "warn"],
  ["I", "info"],
]);

/** One structured log line (4.4 and later); a line that is not one is kept as plain text. */
function entryOf(line: string): ServerLogEntry {
  let parsed: v.SafeParseResult<typeof lineSchema> | null = null;
  try {
    parsed = v.safeParse(lineSchema, JSON.parse(line));
  } catch {
    parsed = null;
  }
  if (parsed === null || !parsed.success)
    return {
      key: { time: Date.now(), id: idOf(line) },
      level: "info",
      message: line,
      digest: null,
      fields: null,
    };
  const entry = parsed.output;
  const fields: JsonObject = {
    component: entry.c ?? null,
    id: entry.id ?? null,
    ctx: entry.ctx ?? null,
  };
  if (entry.attr !== undefined) fields["attr"] = entry.attr;
  return {
    key: { time: Date.parse(entry.t.$date), id: idOf(line) },
    level: SEVERITY.get(entry.s) ?? (entry.s.startsWith("D") ? "debug" : "info"),
    message: entry.msg,
    // The message names the event; its values sit in `attr`, which a masked reader sees as a shape.
    digest: entry.msg,
    fields,
  };
}

async function serverLog(handle: MongoHandle): Promise<ServerLogEntry[]> {
  const answer = v.parse(
    v.object({ log: v.array(v.string()) }),
    await handle.db.admin().command({ getLog: "global" })
  );
  return answer.log.map(entryOf);
}

export async function readServerLog(
  handle: MongoHandle,
  source: ServerLogSource,
  page: ServerLogPage
): Promise<ServerLogRead> {
  if (source === "statements") return pageWindow(await statements(handle), page);
  if (source === "server-log") return pageWindow(await serverLog(handle), page);
  return { entries: [], end: true };
}

/** The sources this credential can read, each found by trying it (D2). */
export async function serverLogSources(handle: MongoHandle): Promise<ServerLogSource[]> {
  const found: ServerLogSource[] = [];
  try {
    await currentOps(handle);
    found.push("statements");
  } catch {
    // Not even its own operations: the screen shows the grant (D3).
  }
  try {
    await handle.db.admin().command({ getLog: "global" });
    found.push("server-log");
  } catch {
    // No `clusterMonitor`: the screen shows the grant (D3).
  }
  return found;
}
