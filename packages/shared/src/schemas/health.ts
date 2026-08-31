import * as v from "valibot";

const checkStatusSchema = v.picklist(["ok", "degraded", "down"]);

export const healthPublicSchema = v.object({
  status: checkStatusSchema,
});

export const healthAdminSchema = v.object({
  status: checkStatusSchema,
  version: v.string(),
  boot_id: v.string(),
  uptime_s: v.number(),
  env: v.picklist(["development", "test", "production"]),
  checks: v.object({
    metadata_db: v.object({ status: checkStatusSchema, latency_ms: v.number() }),
    data_dir: v.object({ status: checkStatusSchema, free_bytes: v.number() }),
    snapshot_store: v.object({
      status: checkStatusSchema,
      driver: v.picklist(["local", "s3"]),
      latency_ms: v.number(),
    }),
    dispatcher: v.object({
      status: checkStatusSchema,
      running: v.number(),
      queued: v.number(),
      last_tick_at: v.nullable(v.string()),
    }),
    log_sink: v.object({ status: checkStatusSchema }),
    sealed_keys: v.object({
      status: checkStatusSchema,
      active_fingerprint: v.string(),
      extra_values: v.number(),
    }),
  }),
});
export type HealthAdmin = v.InferOutput<typeof healthAdminSchema>;
