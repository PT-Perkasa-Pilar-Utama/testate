import * as v from "valibot";

import { adapterDraftSchema } from "./adapters.ts";
import { CAP_RULE, RETENTION_RULE } from "./logs.ingest.ts";
import { DOCKER_CONTAINER } from "./logs.docker.ts";
import { journalUnitSchema } from "./logs.journald.ts";
import { logFormatSchema, logGlobSchema, logSourceNameSchema, safePatternSchema } from "./logs.ts";

/**
 * The logfile dialog's static fields (#69, S1). The connection's own fields are keyed by transport
 * at runtime (`ENGINE_FORMS.sftp` or `.s3`), so they stay outside this schema as the create dialog's
 * do. Text boxes hold "" for "none", and the masking patterns are one per line.
 */
export const LOG_TRANSPORTS = ["sftp", "s3"] as const;
export type LogTransport = (typeof LOG_TRANSPORTS)[number];

/** The non-blank lines of a text box, trimmed. */
export function patternLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The first reason `pattern` is refused, or null when it is a safe pattern. */
function refusal(pattern: string): string | null {
  const parsed = v.safeParse(safePatternSchema, pattern);
  return parsed.success ? null : parsed.issues[0].message;
}

const regexText = v.pipe(
  v.string(),
  v.rawCheck(({ dataset, addIssue }) => {
    const reason = dataset.typed && dataset.value !== "" ? refusal(dataset.value) : null;
    if (reason !== null) addIssue({ message: reason });
  })
);

const patternsText = v.pipe(
  v.string(),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const reasons = patternLines(dataset.value).map(refusal);
    const line = reasons.findIndex((reason) => reason !== null);
    if (line !== -1) addIssue({ message: `Line ${line + 1}: ${reasons[line]}` });
  })
);

export const logSourceFormSchema = v.pipe(
  v.object({
    name: logSourceNameSchema,
    glob: logGlobSchema,
    format: logFormatSchema,
    regex: regexText,
    patterns: patternsText,
  }),
  v.forward(
    v.partialCheck(
      [["format"], ["regex"]],
      (source) => source.format !== "regex" || source.regex !== "",
      "The regex format needs a pattern."
    ),
    ["regex"]
  )
);
export type LogSourceFormInput = v.InferInput<typeof logSourceFormSchema>;

export const logfileFormSchema = v.object({
  name: adapterDraftSchema.entries.name,
  transport: v.picklist(LOG_TRANSPORTS),
  sources: v.pipe(
    v.array(logSourceFormSchema),
    v.minLength(1, "Add at least one source."),
    v.maxLength(32, "A log adapter holds at most 32 sources."),
    v.check(
      (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
      "Each source needs its own name."
    )
  ),
});
export type LogfileFormInput = v.InferInput<typeof logfileFormSchema>;
export type LogfileForm = v.InferOutput<typeof logfileFormSchema>;

/** A number box's text as a whole number in range: a form field holds text (`adapterEditFormSchema`). */
const wholeText = (rule: { min: number; max: number; message: string }) =>
  v.pipe(
    v.string(),
    v.check((raw) => {
      const value = Number(raw);
      return raw.trim() !== "" && Number.isInteger(value) && value >= rule.min && value <= rule.max;
    }, rule.message),
    v.transform(Number)
  );

/** The "Push from your app" dialog (I8): a name, how long to keep lines, and the size cap. */
export const ingestFormSchema = v.object({
  name: adapterDraftSchema.entries.name,
  retention_days: wholeText(RETENTION_RULE),
  cap_mb: wholeText(CAP_RULE),
});
export type IngestFormInput = v.InferInput<typeof ingestFormSchema>;
export type IngestForm = v.InferOutput<typeof ingestFormSchema>;

/** The units box's names: split on spaces, commas or lines (#86, J3). */
export function unitWords(text: string): string[] {
  return text.split(/[\s,]+/).filter((word) => word !== "");
}

const unitsText = v.pipe(
  v.string(),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const words = unitWords(dataset.value);
    const reasons = words.map((word) => v.safeParse(journalUnitSchema, word).issues?.[0].message);
    const at = reasons.findIndex((reason) => reason !== undefined);
    if (at !== -1) addIssue({ message: `${words[at]}: ${reasons[at]}` });
    if (words.length > 32) addIssue({ message: "A source names at most 32 units." });
  })
);

/** One journal source as the dialog shows it: units and masking patterns are text boxes. */
export const journalSourceFormSchema = v.object({
  name: logSourceNameSchema,
  units: unitsText,
  patterns: patternsText,
});

/** The "systemd journal over SSH" dialog (#86): the SSH login is `ENGINE_FORMS.journald`'s. */
export const journaldFormSchema = v.object({
  name: adapterDraftSchema.entries.name,
  sources: v.pipe(
    v.array(journalSourceFormSchema),
    v.minLength(1, "Add at least one source."),
    v.maxLength(32, "A log adapter holds at most 32 sources."),
    v.check(
      (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
      "Each source needs its own name."
    )
  ),
});
export type JournaldFormInput = v.InferInput<typeof journaldFormSchema>;
export type JournaldForm = v.InferOutput<typeof journaldFormSchema>;

/** The "Docker containers" dialog's transports (#88, K1). */
export const DOCKER_TRANSPORTS = ["ssh", "tcp"] as const;

/** One container source as the dialog shows it: a format, and masking patterns one per line. */
export const dockerSourceFormSchema = v.pipe(
  v.object({
    name: logSourceNameSchema,
    container: v.pipe(
      v.string(),
      v.minLength(1, "Enter the container's name."),
      v.regex(DOCKER_CONTAINER, "A container name holds letters, digits and _ . - only.")
    ),
    format: logFormatSchema,
    regex: regexText,
    patterns: patternsText,
  }),
  v.forward(
    v.partialCheck(
      [["format"], ["regex"]],
      (source) => source.format !== "regex" || source.regex !== "",
      "The regex format needs a pattern."
    ),
    ["regex"]
  )
);

/** The dialog's static fields; the connection's are `DOCKER_FORMS[transport]` in the SPA. */
export const dockerFormSchema = v.object({
  name: adapterDraftSchema.entries.name,
  transport: v.picklist(DOCKER_TRANSPORTS),
  sources: v.pipe(
    v.array(dockerSourceFormSchema),
    v.minLength(1, "Add at least one source."),
    v.maxLength(32, "A log adapter holds at most 32 sources."),
    v.check(
      (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
      "Each source needs its own name."
    )
  ),
});
export type DockerFormInput = v.InferInput<typeof dockerFormSchema>;
export type DockerForm = v.InferOutput<typeof dockerFormSchema>;
