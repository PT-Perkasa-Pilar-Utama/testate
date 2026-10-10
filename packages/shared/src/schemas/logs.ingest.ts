import * as v from "valibot";

/**
 * The `ingest` log engine's contract (#75; decisions Q4b and I1–I9 of
 * docs/decisions/2026-10-10-logs-tier.md): apps push `testate`-format JSON lines to Testate.
 */
export const INGEST_RETENTION_DEFAULT = 7;
export const INGEST_CAP_MB_DEFAULT = 1024;
/** A push body is at most this big (Q4b). */
export const INGEST_BODY_MAX = 1024 * 1024;

const whole = (min: number, max: number, message: string) =>
  v.pipe(v.number(), v.integer(message), v.minValue(min, message), v.maxValue(max, message));

export const ingestConfigSchema = v.object({
  retention_days: v.optional(whole(1, 90, "Keep logs for 1 to 90 days."), INGEST_RETENTION_DEFAULT),
  cap_mb: v.optional(whole(1, 10240, "Cap the logs at 1 to 10240 MB."), INGEST_CAP_MB_DEFAULT),
});
export type IngestConfig = v.InferOutput<typeof ingestConfigSchema>;

/** What a push stored (I6): `malformed` counts lines kept as text because they were not JSON. */
export const ingestAnswerSchema = v.object({ accepted: v.number(), malformed: v.number() });
export type IngestAnswer = v.InferOutput<typeof ingestAnswerSchema>;

/** A new ingest token, shown once (I8). */
export const ingestTokenSchema = v.object({ token: v.string(), prefix: v.string() });
export type IngestToken = v.InferOutput<typeof ingestTokenSchema>;

/** The sources a log adapter has: a `logfile`'s configured names, an `ingest`'s folders (I2). */
export const logSourcesSchema = v.array(v.string());
