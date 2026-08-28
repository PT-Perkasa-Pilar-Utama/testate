import * as v from "valibot";

import { sealedSchema } from "./common.ts";

const nonNegativeInt = v.pipe(v.number(), v.integer(), v.minValue(0));
const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));

export const s3StoreSchema = v.object({
  bucket: v.string(),
  prefix: v.string(),
  region: v.nullable(v.string()),
  endpoint: v.nullable(v.string()),
  virtual_hosted: v.boolean(),
  access_key_id: sealedSchema,
  secret_access_key: sealedSchema,
});

export const settingsSchema = v.object({
  store: v.object({
    driver: v.picklist(["local", "s3"]),
    s3: v.nullable(s3StoreSchema),
    locked_by_env: v.boolean(),
  }),
  retention: v.object({
    stash_keep: positiveInt,
    diff_days: positiveInt,
    query_history_days: positiveInt,
    job_history_days: positiveInt,
    audit_days: positiveInt,
    import_run_days: positiveInt,
  }),
  quota: v.object({
    default_bytes: nonNegativeInt,
    instance_ceiling_bytes: v.nullable(nonNegativeInt),
  }),
  limits: v.object({
    query_rows_default: positiveInt,
    query_rows_max: positiveInt,
    query_bytes: positiveInt,
    query_timeout_ms: positiveInt,
    query_timeout_max_ms: positiveInt,
    upload_mb: positiveInt,
    token_requests_per_minute: positiveInt,
    agent_requests_per_minute: positiveInt,
    write_session_idle_minutes: positiveInt,
    job_concurrency: positiveInt,
  }),
  netguard: v.object({
    deny: v.array(v.string()),
    fixed: v.array(v.string()),
  }),
  log: v.object({
    sample_rate_by_route: v.record(v.string(), v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  }),
  locked_by_env: v.array(v.string()),
});
export type Settings = v.InferOutput<typeof settingsSchema>;

export const updateSettingsSchema = v.partial(
  v.object({
    retention: v.partial(settingsSchema.entries.retention),
    quota: v.partial(settingsSchema.entries.quota),
    limits: v.partial(settingsSchema.entries.limits),
    netguard: v.object({ deny: v.array(v.string()) }),
    log: settingsSchema.entries.log,
    store: v.object({
      s3: v.object({
        bucket: v.string(),
        prefix: v.string(),
        region: v.nullable(v.string()),
        endpoint: v.nullable(v.string()),
        virtual_hosted: v.boolean(),
        access_key_id: v.string(),
        secret_access_key: v.string(),
      }),
    }),
  })
);

export const storeMigrationSchema = v.object({
  target: v.union([
    v.object({ driver: v.literal("local") }),
    v.object({
      driver: v.literal("s3"),
      s3: v.object({
        bucket: v.string(),
        prefix: v.string(),
        region: v.optional(v.string()),
        endpoint: v.optional(v.string()),
        virtual_hosted: v.optional(v.boolean(), true),
        access_key_id: v.string(),
        secret_access_key: v.string(),
      }),
    }),
  ]),
});

export const backupRequestSchema = v.object({
  include_blobs: v.optional(v.boolean(), false),
  destination: v.optional(v.picklist(["download", "store"]), "download"),
});

export const settingsPatchResultSchema = v.object({
  ...settingsSchema.entries,
  disabled_adapters: v.optional(v.array(v.string())),
});
