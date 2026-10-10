/**
 * The one command a `journald` adapter runs on its host (#86; J2 of
 * docs/decisions/2026-10-10-journald.md). Every argument is built here from checked values and
 * single-quoted; nothing a person typed reaches the command line.
 */
import type { LogLevel } from "@testate/shared";
import { JOURNAL_UNIT } from "@testate/shared";

import { AppError } from "../../http/index.ts";

/** journald's own `__CURSOR` (`s=…;i=…;b=…;m=…;t=…;x=…`), checked by its characters only (J4). */
export const JOURNAL_CURSOR = /^[A-Za-z0-9=;:+/_.-]{1,512}$/;

/** A POSIX shell word: the argument inside single quotes, each `'` closed, escaped and reopened. */
export function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

/** The read query's level floor as journalctl's `-p`, which shows that priority and worse. */
const PRIORITY = new Map<LogLevel, string>([
  ["trace", "debug"],
  ["debug", "debug"],
  ["info", "info"],
  ["warn", "warning"],
  ["error", "err"],
  ["fatal", "crit"],
]);

export type JournalCommand = {
  lines: number;
  units: readonly string[];
  /** Epoch milliseconds; sent as `@<seconds>`, systemd's absolute form. */
  since?: number | undefined;
  until?: number | undefined;
  /** `after`: entries following the cursor (follow); `at`: from the cursor on, with `reverse`. */
  cursor?: { mode: "after" | "at"; value: string } | undefined;
  reverse?: boolean | undefined;
  level?: LogLevel | undefined;
};

function refused(what: string): AppError {
  return new AppError(
    "VALIDATION_ERROR",
    `${what} is not something Testate will send to journalctl`
  );
}

const seconds = (ms: number): string => `@${Math.floor(ms / 1000)}`;

function windowArgs(command: JournalCommand): string[] {
  const args: string[] = [];
  if (command.reverse === true) args.push("-r");
  if (command.since !== undefined) args.push(`--since=${seconds(command.since)}`);
  if (command.until !== undefined) args.push(`--until=${seconds(command.until)}`);
  return args;
}

function cursorArgs(cursor: JournalCommand["cursor"]): string[] {
  if (cursor === undefined) return [];
  if (!JOURNAL_CURSOR.test(cursor.value)) throw refused("that cursor");
  return [`${cursor.mode === "after" ? "--after-cursor" : "--cursor"}=${cursor.value}`];
}

function unitArgs(units: readonly string[]): string[] {
  return units.flatMap((unit) => {
    if (!JOURNAL_UNIT.test(unit) || unit.startsWith("-")) throw refused("that unit name");
    return ["-u", unit];
  });
}

function levelArgs(level: LogLevel | undefined): string[] {
  const priority = level === undefined ? undefined : PRIORITY.get(level);
  return priority === undefined ? [] : ["-p", priority];
}

/** The command line, or `VALIDATION_ERROR` for any value outside its allow-list. */
export function journalCommand(command: JournalCommand): string {
  if (!Number.isInteger(command.lines) || command.lines < 1 || command.lines > 10001)
    throw refused("that line count");
  return [
    "journalctl",
    "-o",
    "json",
    "--no-pager",
    "--quiet",
    "-n",
    String(command.lines),
    ...windowArgs(command),
    ...cursorArgs(command.cursor),
    ...unitArgs(command.units),
    ...levelArgs(command.level),
  ]
    .map(shellQuote)
    .join(" ");
}
