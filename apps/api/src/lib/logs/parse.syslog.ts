/**
 * syslog, both shapes: RFC 5424 (`<PRI>1 TIMESTAMP HOST APP ...`) and the older RFC 3164
 * (`<PRI>Mon DD HH:MM:SS HOST TAG: ...`). RFC 3164 carries no year and no zone: it is read as this
 * year, UTC, and last year when that would put it in the future (decision log, parser rules).
 */
import type { LogLevel } from "@testate/shared";

import { timeOfText } from "./fields.ts";
import type { ParsedLine } from "./parse.ts";

const RFC5424 =
  /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (?:-|\[[^\]]*\](?:\[[^\]]*\])*) ?([\s\S]*)$/;
const RFC3164 =
  /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\S+) ([^:]+): ?([\s\S]*)$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEVERITY: LogLevel[] = ["fatal", "fatal", "fatal", "error", "warn", "info", "info", "debug"];

function severityOf(pri: string | undefined): LogLevel | null {
  return pri === undefined ? null : (SEVERITY[Number(pri) % 8] ?? null);
}

/** An RFC 3164 date, which has no year: this year, or last year if that would be the future. */
export function yearless(month: string, day: string, clock: string, now: number): number | null {
  const index = MONTHS.indexOf(month);
  if (index === -1) return null;
  const year = new Date(now).getUTCFullYear();
  const at = (y: number): number =>
    Date.parse(`${y}-${String(index + 1).padStart(2, "0")}-${day.padStart(2, "0")}T${clock}Z`);
  const thisYear = at(year);
  return thisYear > now + 86_400_000 ? at(year - 1) : thisYear;
}

function rfc5424(match: RegExpExecArray): ParsedLine {
  const [, pri, timestamp, host, app] = match;
  return {
    time: timestamp === undefined ? null : timeOfText(timestamp),
    level: severityOf(pri),
    message: match[7] ?? "",
    fields: { host: host ?? "-", app: app ?? "-" },
  };
}

function rfc3164(match: RegExpExecArray, now: number): ParsedLine {
  const [, pri, month, day, clock, host, tag] = match;
  return {
    time: month && day && clock ? yearless(month, day, clock, now) : null,
    level: severityOf(pri),
    message: match[7] ?? "",
    fields: { host: host ?? "-", app: tag ?? "-" },
  };
}

export function syslog(line: string, now: number = Date.now()): ParsedLine {
  const modern = RFC5424.exec(line);
  if (modern !== null) return rfc5424(modern);
  const legacy = RFC3164.exec(line);
  if (legacy !== null) return rfc3164(legacy, now);
  return { time: null, level: null, message: line, fields: null };
}
