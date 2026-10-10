import * as v from "valibot";

import { logSourceNameSchema, safePatternSchema } from "./logs.ts";

/**
 * The `journald` log engine (#86; J1–J6 of docs/decisions/2026-10-10-journald.md): a Linux host's
 * systemd journal over SSH, read with one fixed `journalctl` command.
 */

/** A systemd unit name as journalctl's `-u` takes it: no space, no shell character, no leading `-` (J2). */
export const JOURNAL_UNIT = /^[A-Za-z0-9:_.@-]{1,255}$/;

const unitSchema = v.pipe(
  v.string(),
  v.regex(JOURNAL_UNIT, "A unit name holds letters, digits and : _ . @ - only."),
  v.check((unit) => !unit.startsWith("-"), "A unit name cannot start with -.")
);

/** A named group of units; none means the whole journal (J3). */
export const journalSourceSchema = v.object({
  name: logSourceNameSchema,
  units: v.optional(v.pipe(v.array(unitSchema), v.maxLength(32)), []),
  patterns: v.optional(v.array(safePatternSchema), []),
});
export type JournalSource = v.InferOutput<typeof journalSourceSchema>;

const text = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const port = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535));

export const journaldConfigSchema = v.object({
  host: text,
  port: v.optional(port),
  user: text,
  sources: v.pipe(
    v.array(journalSourceSchema),
    v.minLength(1, "Add at least one source."),
    v.maxLength(32),
    v.check(
      (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
      "Each source needs its own name."
    )
  ),
});
export type JournaldConfig = v.InferOutput<typeof journaldConfigSchema>;
