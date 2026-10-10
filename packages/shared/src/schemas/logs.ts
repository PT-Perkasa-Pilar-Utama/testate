import * as v from "valibot";

import { timestampSchema } from "./common.ts";
import { jsonObjectSchema } from "./json.ts";

/**
 * The Logs tier's contract (#37, #69; docs/decisions/2026-10-10-logs-tier.md). Read-only by
 * construction: there is no write half to describe.
 */
export const LOG_FORMATS = ["pm2", "json-lines", "testate", "syslog", "plain", "regex"] as const;
export const logFormatSchema = v.picklist(LOG_FORMATS);
export type LogFormat = v.InferOutput<typeof logFormatSchema>;

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export const logLevelSchema = v.picklist(LOG_LEVELS);
export type LogLevel = v.InferOutput<typeof logLevelSchema>;

/**
 * A tester-supplied regex: compiled at save, short, and with no nested quantifier (decision log).
 * ponytail: a syntactic screen for catastrophic backtracking, not a proof; the runtime has no
 * regex timeout. Lines are also cut at 16 KB before matching. Upgrade: RE2.
 */
export const safePatternSchema = v.pipe(
  v.string(),
  v.minLength(1, "Enter a pattern."),
  v.maxLength(200, "A pattern has at most 200 characters."),
  v.check((pattern) => {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }, "That pattern is not a valid regular expression."),
  v.check(
    (pattern) => !/\([^)]*[+*][^)]*\)[+*{]/.test(pattern),
    "A quantifier on a group that repeats can stall every read. Rewrite it without nesting."
  )
);

/**
 * One named source on a `logfile` adapter (S1): a file-name pattern in one directory under the
 * connection's root, read in one format.
 */
export const logSourceSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
    /** `logs/api-*.log`: a directory, then a pattern on the file name. No `**`, no `~`. */
    glob: v.pipe(
      v.string(),
      v.minLength(1),
      v.maxLength(512),
      v.check((glob) => !glob.includes("**") && !glob.startsWith("~"), "No ** and no ~ in a glob."),
      v.check((glob) => !glob.split("/").includes(".."), "A glob stays under the root.")
    ),
    format: logFormatSchema,
    /** The `regex` format's pattern: named groups `time`, `level` and `message`, the rest fields. */
    regex: v.optional(safePatternSchema),
    /** Extra masking patterns on top of the built-in ones (Q5). */
    patterns: v.optional(v.array(safePatternSchema), []),
  }),
  v.check(
    (source) => source.format !== "regex" || source.regex !== undefined,
    "The regex format needs a pattern."
  )
);
export type LogSource = v.InferOutput<typeof logSourceSchema>;

const sourcesSchema = v.pipe(
  v.array(logSourceSchema),
  v.minLength(1, "Add at least one source."),
  v.maxLength(32),
  v.check(
    (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
    "Each source needs its own name."
  )
);

const text = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const port = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535));

/** A `logfile` adapter: one connection, SFTP or S3, holding its named sources (S1). */
export const logfileConfigSchema = v.variant("transport", [
  v.object({
    transport: v.literal("sftp"),
    host: text,
    port: v.optional(port),
    user: text,
    root_path: v.optional(v.string(), "/"),
    sources: sourcesSchema,
  }),
  v.object({
    transport: v.literal("s3"),
    bucket: text,
    prefix: v.optional(v.string(), ""),
    region: text,
    endpoint: v.optional(v.pipe(v.string(), v.url())),
    virtual_hosted: v.optional(v.boolean(), false),
    sources: sourcesSchema,
  }),
]);
export type LogfileConfig = v.InferOutput<typeof logfileConfigSchema>;

/** One entry as a reader sees it: parsed, masked where the reader is masked (Q5). */
export const logEntrySchema = v.object({
  time: timestampSchema,
  level: logLevelSchema,
  /** The file it came from, so pm2's out and error lines can be told apart once merged (S2). */
  file: v.string(),
  message: v.string(),
  fields: v.nullable(jsonObjectSchema),
  masked: v.boolean(),
});
export type LogEntry = v.InferOutput<typeof logEntrySchema>;

export const LOG_LINE_DEFAULT = 200;
export const LOG_LINE_MAX = 5000;

const numberish = v.pipe(
  v.union([v.number(), v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number))]),
  v.integer(),
  v.minValue(1),
  v.maxValue(LOG_LINE_MAX)
);

/** The read query (Q6): a window, filters, and a cursor going back (`cursor`) or forward (`after`). */
export const logsQuerySchema = v.object({
  source: v.pipe(v.string(), v.minLength(1)),
  from: v.optional(timestampSchema),
  to: v.optional(timestampSchema),
  level: v.optional(logLevelSchema),
  text: v.optional(v.pipe(v.string(), v.maxLength(200))),
  limit: v.optional(numberish, LOG_LINE_DEFAULT),
  cursor: v.optional(v.string()),
  after: v.optional(v.string()),
});
export type LogsQuery = v.InferOutput<typeof logsQuerySchema>;

/** What cut an answer short, so a reader knows older lines exist and which ceiling hid them. */
export const LOG_CUTS = ["lines", "bytes", "window"] as const;

export const logsPageSchema = v.object({
  entries: v.array(logEntrySchema),
  /** Older entries, or null when the start of every file was reached. */
  cursor: v.nullable(v.string()),
  /** Newer entries from here on: what "follow" polls with (Q7). */
  after: v.string(),
  cut_by: v.nullable(v.picklist(LOG_CUTS)),
  /** A file had no timestamps: its lines are in file order and the window cannot filter them. */
  untimed: v.boolean(),
});
export type LogsPage = v.InferOutput<typeof logsPageSchema>;
