import * as v from "valibot";

export const ROLES = ["admin", "qa", "viewer"] as const;
export const roleSchema = v.picklist(ROLES);
export type Role = v.InferOutput<typeof roleSchema>;

export const TOKEN_KINDS = ["standard", "agent"] as const;
export const tokenKindSchema = v.picklist(TOKEN_KINDS);
export type TokenKind = v.InferOutput<typeof tokenKindSchema>;

export const ADAPTER_KINDS = ["database", "storage", "rest"] as const;
export const adapterKindSchema = v.picklist(ADAPTER_KINDS);
export type AdapterKind = v.InferOutput<typeof adapterKindSchema>;

export const ENGINES = [
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "s3",
  "sftp",
  "ftp",
  "http",
] as const;
export const engineSchema = v.picklist(ENGINES);
export type Engine = v.InferOutput<typeof engineSchema>;

export const TIERS = ["files", "document", "tabular"] as const;
export const tierSchema = v.picklist(TIERS);
export type Tier = v.InferOutput<typeof tierSchema>;

export const ADAPTER_MODES = ["sandbox", "read_only"] as const;
export const adapterModeSchema = v.picklist(ADAPTER_MODES);
export type AdapterMode = v.InferOutput<typeof adapterModeSchema>;

export const ADAPTER_STATUSES = ["ok", "error", "disabled"] as const;
export const adapterStatusSchema = v.picklist(ADAPTER_STATUSES);

export const STATE_KINDS = ["init", "manual", "stash", "diff"] as const;
export const stateKindSchema = v.picklist(STATE_KINDS);
export type StateKind = v.InferOutput<typeof stateKindSchema>;

export const STATE_STATUSES = ["creating", "ready", "failed"] as const;
export const stateStatusSchema = v.picklist(STATE_STATUSES);
export type StateStatus = v.InferOutput<typeof stateStatusSchema>;

export const HEAD_STATUSES = ["none", "at_state", "unknown"] as const;
export const headStatusSchema = v.picklist(HEAD_STATUSES);
export type HeadStatus = v.InferOutput<typeof headStatusSchema>;

export const JOB_KINDS = [
  "snapshot",
  "checkout",
  "import",
  "diff",
  "state_delete",
  "adapter_delete",
  "project_delete",
  "archive_import",
  "storage_migration",
  "backup",
] as const;
export const jobKindSchema = v.picklist(JOB_KINDS);
export type JobKind = v.InferOutput<typeof jobKindSchema>;

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "partial",
  "interrupted",
] as const;
export const jobStatusSchema = v.picklist(JOB_STATUSES);
export type JobStatus = v.InferOutput<typeof jobStatusSchema>;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "partial",
  "interrupted",
];

export const CHECKOUT_RESULTS = [
  "pending",
  "restored",
  "skipped",
  "rolled_back",
  "unknown",
  "counters_failed",
] as const;
export const checkoutResultSchema = v.picklist(CHECKOUT_RESULTS);

export const HOOK_TRIGGERS = [
  "before_checkout",
  "after_checkout",
  "after_snapshot",
  "after_import",
] as const;
export const hookTriggerSchema = v.picklist(HOOK_TRIGGERS);

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "ADAPTER_READ_ONLY",
  "NOT_FOUND",
  "CONFLICT",
  "SCHEMA_DRIFT",
  "JOB_IN_PROGRESS",
  "CHECKOUT_BLOCKED",
  "QUOTA_EXCEEDED",
  "PAYLOAD_TOO_LARGE",
  "ENGINE_UNSUPPORTED",
  "HOST_BLOCKED",
  "RATE_LIMITED",
  "ADAPTER_UNREACHABLE",
  "INTERNAL",
] as const;
export const errorCodeSchema = v.picklist(ERROR_CODES);
export type ErrorCode = v.InferOutput<typeof errorCodeSchema>;

export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  ADAPTER_READ_ONLY: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SCHEMA_DRIFT: 409,
  JOB_IN_PROGRESS: 409,
  CHECKOUT_BLOCKED: 409,
  QUOTA_EXCEEDED: 409,
  PAYLOAD_TOO_LARGE: 413,
  ENGINE_UNSUPPORTED: 422,
  HOST_BLOCKED: 422,
  RATE_LIMITED: 429,
  ADAPTER_UNREACHABLE: 502,
  INTERNAL: 500,
} as const satisfies Record<ErrorCode, number>;
