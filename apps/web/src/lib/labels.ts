// One shared module for the words a person reads for each enum value. Before this file the same
// value was labelled three different ways in three screens (checkouts, jobs, states timeline),
// and a dropdown showed the raw enum almost everywhere else. Every screen reads its labels from
// here instead of writing its own.

import type * as v from "valibot";

import { ENGINES, ROLES, TOKEN_KINDS, fieldModeSchema, importModeSchema } from "@testate/shared";
import type { functionNameSchema, maskSchema, restoreModeSchema } from "@testate/shared";
import type {
  AdapterKind,
  AdapterMode,
  AuditRow,
  Checkout,
  Diff,
  DiffRow,
  Engine,
  Entry,
  HeadStatus,
  JobKind,
  JobStatus,
  RestoreStrategy,
  Role,
  StateKind,
  StateStatus,
  StoreMigrationFormInput,
  Tier,
  TokenKind,
} from "@testate/shared";
import type { ADAPTER_STATUSES, CHECKOUT_RESULTS } from "@testate/shared";

// Neither type is exported from the shared package; the picklist values are the only shape
// either one needs, so they are derived here rather than by editing enums.ts for this alone.
type AdapterStatus = (typeof ADAPTER_STATUSES)[number];
type CheckoutResult = (typeof CHECKOUT_RESULTS)[number];

// Audit outcome is a picklist inline in the audit row schema, not a named export, so the real
// values (never null) come from the row type rather than a second hand-typed list.
type AuditOutcome = Exclude<AuditRow["outcome"], null>;

// Same reasoning as AdapterStatus/CheckoutResult above: these schemas are exported but no named
// type rides along with them.
type FieldMode = v.InferOutput<typeof fieldModeSchema>;
type FunctionName = v.InferOutput<typeof functionNameSchema>;
type Mask = v.InferOutput<typeof maskSchema>;
type ImportMode = v.InferOutput<typeof importModeSchema>;
type RestoreMode = v.InferOutput<typeof restoreModeSchema>;
// diffRowSchema has no standalone type for its op field; DiffRow already carries it.
type DiffOp = DiffRow["op"];
// diffSchema has no standalone type for its status field either; Diff already carries it.
type DiffStatus = Diff["status"];
// checkoutSchema has no standalone type for its purpose field; Checkout already carries it.
type CheckoutPurpose = Checkout["purpose"];
type EntryKind = Entry["kind"];
type EmptyMode = RestoreStrategy["emptyMode"];
type ForeignKeyHandling = RestoreStrategy["foreignKeyHandling"];
// The store driver picklist is inline in the settings schema, not a named export, so the union
// comes from the migrate-store form input type rather than a second hand-typed list.
type StoreDriver = StoreMigrationFormInput["driver"];
// Grid filter operators and the import wizard's value transforms are picklists local to those
// features, not shared-package enums, so the union lives here rather than importing a features
// file into lib (imports run the other way: features depend on lib, not back).
type FilterOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "like" | "in" | "null" | "notnull";
type ImportValueTransform = "trim" | "emptyToNull" | "number" | "uuid" | "now" | "json";

export const ROLE_LABEL = {
  admin: "Administrator",
  qa: "Tester",
  viewer: "Guest",
} as const satisfies Record<Role, string>;
export const ROLE_OPTIONS = ROLES.map((value) => ({ value, label: ROLE_LABEL[value] }));

export const TOKEN_KIND_LABEL = {
  standard: "Standard",
  agent: "Agent",
} as const satisfies Record<TokenKind, string>;
export const TOKEN_KIND_OPTIONS = TOKEN_KINDS.map((value) => ({
  value,
  label: TOKEN_KIND_LABEL[value],
}));

export const ADAPTER_KIND_LABEL = {
  database: "Database",
  storage: "Storage",
} as const satisfies Record<AdapterKind, string>;

export const ENTRY_KIND_LABEL = {
  file: "File",
  directory: "Folder",
} as const satisfies Record<EntryKind, string>;

export const ENGINE_LABEL = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
  s3: "S3",
  sftp: "SFTP",
  ftp: "FTP",
} as const satisfies Record<Engine, string>;
export const ENGINE_OPTIONS = ENGINES.map((value) => ({ value, label: ENGINE_LABEL[value] }));

export const TIER_LABEL = {
  files: "Files",
  document: "Documents",
  tabular: "Tables",
} as const satisfies Record<Tier, string>;

export const ADAPTER_MODE_LABEL = {
  sandbox: "Sandbox",
  read_only: "Read only",
} as const satisfies Record<AdapterMode, string>;
/**
 * The dropdown says what each mode lets you do, which is the whole difference between them; the
 * label above is the short form a badge or a fact line wants.
 */
export const ADAPTER_MODE_OPTIONS = [
  { value: "sandbox", label: "Sandbox (restores allowed)" },
  { value: "read_only", label: "Read only (never written to)" },
] as const satisfies readonly { value: AdapterMode; label: string }[];

export const ADAPTER_STATUS_LABEL = {
  ok: "OK",
  error: "Error",
  disabled: "Disabled",
} as const satisfies Record<AdapterStatus, string>;

export const STATE_KIND_LABEL = {
  init: "Starting point",
  manual: "State",
  stash: "Stash",
  diff: "Comparison",
} as const satisfies Record<StateKind, string>;

export const STATE_STATUS_LABEL = {
  creating: "Creating",
  ready: "Ready",
  failed: "Failed",
} as const satisfies Record<StateStatus, string>;

export const HEAD_STATUS_LABEL = {
  none: "Not at a state",
  at_state: "At a state",
  unknown: "Unknown",
} as const satisfies Record<HeadStatus, string>;

export const JOB_KIND_LABEL = {
  snapshot: "Snapshot",
  checkout: "Checkout",
  import: "Import",
  diff: "Comparison",
  state_delete: "Delete a state",
  adapter_delete: "Delete an adapter",
  project_delete: "Delete a project",
  archive_import: "Import archive",
  storage_migration: "Storage migration",
  backup: "Backup",
} as const satisfies Record<JobKind, string>;

export const JOB_STATUS_LABEL = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  partial: "Partial",
  interrupted: "Interrupted",
} as const satisfies Record<JobStatus, string>;

export const CHECKOUT_RESULT_LABEL = {
  pending: "Pending",
  restored: "Restored",
  skipped: "Skipped",
  rolled_back: "Rolled back",
  unknown: "Unknown",
  counters_failed: "Counters failed",
} as const satisfies Record<CheckoutResult, string>;

// Lowercase on purpose: this reads inline in a sentence ("checked out · Running · by Jane"),
// not on its own in a badge like the maps above it.
export const CHECKOUT_PURPOSE_LABEL = {
  checkout: "checked out",
  return_to_init: "returned to the starting point",
} as const satisfies Record<CheckoutPurpose, string>;

export const AUDIT_OUTCOME_LABEL = {
  succeeded: "Succeeded",
  failed: "Failed",
  partial: "Partial",
} as const satisfies Record<AuditOutcome, string>;

export const FIELD_MODE_LABEL = {
  value: "Value",
  null: "NULL",
  default: "Default",
  function: "Function",
} as const satisfies Record<FieldMode, string>;
export const FIELD_MODE_OPTIONS = fieldModeSchema.options.map((value) => ({
  value,
  label: FIELD_MODE_LABEL[value],
}));

export const FUNCTION_NAME_LABEL = {
  now: "Current time",
  uuid_v4: "UUID v4",
  uuid_v7: "UUID v7",
  random_hex: "Random hex",
  random_base64: "Random base64",
  hash_bcrypt: "Bcrypt hash",
  hash_argon2id: "Argon2id hash",
  hash_sha256: "SHA-256 hash",
  hash_sha512: "SHA-512 hash",
  hmac_sha256: "HMAC-SHA256",
} as const satisfies Record<FunctionName, string>;

export const MASK_LABEL = {
  redact: "Redact",
  partial: "Partial",
  hash: "Hash",
} as const satisfies Record<Mask, string>;

export const IMPORT_MODE_LABEL = {
  append: "Add these rows",
  upsert: "Add new rows, update existing ones",
  replace: "Clear the table, then load this file",
} as const satisfies Record<ImportMode, string>;
export const IMPORT_MODE_OPTIONS = importModeSchema.options.map((value) => ({
  value,
  label: IMPORT_MODE_LABEL[value],
}));

export const IMPORT_VALUE_TRANSFORM_LABEL = {
  trim: "Trim extra spaces",
  emptyToNull: "Treat blank cells as no value",
  number: "Convert text to a number",
  uuid: "Generate a unique ID",
  now: "Fill in today's date and time",
  json: "Read as structured data (JSON)",
} as const satisfies Record<ImportValueTransform, string>;

export const DIFF_OP_LABEL = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
} as const satisfies Record<DiffOp, string>;

export const DIFF_STATUS_LABEL = {
  running: "Running",
  ready: "Ready",
  failed: "Failed",
} as const satisfies Record<DiffStatus, string>;

// Filter-operator symbols, not words: the grid toolbar's operator select is a fixed w-24 box next
// to the column and value fields, and "=" / "≠" / "≤" read faster there than "equals" / "not equals".
export const FILTER_OP_LABEL = {
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  like: "like",
  in: "in",
  null: "is null",
  notnull: "not null",
} as const satisfies Record<FilterOp, string>;

/** The short form a badge wants; the dropdown below says what each one actually is. */
export const STORE_DRIVER_LABEL = {
  local: "Local disk",
  s3: "S3",
} as const satisfies Record<StoreDriver, string>;

export const STORE_DRIVER_OPTIONS = [
  { value: "local", label: "Local disk" },
  { value: "s3", label: "S3-compatible bucket" },
] as const satisfies readonly { value: StoreDriver; label: string }[];

// "fast" is unused today (see the ponytail note where the edit dialog builds its options), but
// the label map covers the full picklist so the entry is ready the day that option ships.
export const RESTORE_MODE_LABEL = {
  atomic: "atomic (one transaction)",
  fast: "fast",
} as const satisfies Record<RestoreMode, string>;

export const EMPTY_MODE_LABEL = {
  truncate: "truncate",
  delete: "delete",
  "delete-many": "delete in batches",
} as const satisfies Record<EmptyMode, string>;

export const FK_HANDLING_LABEL = {
  "session-disable": "FKs disabled for the session",
  "dependency-order": "FKs restored in dependency order",
  "not-applicable": "no FKs",
} as const satisfies Record<ForeignKeyHandling, string>;

// `engine` on a preflight, checkout, or state-detail row is plain text in the shared schema, not
// the `Engine` picklist, so a value the map does not carry passes through unchanged.
export function engineLabel(engine: string): string {
  return engine in ENGINE_LABEL
    ? // SAFETY: the `in` check above proved `engine` names one of ENGINE_LABEL's own properties.
      ENGINE_LABEL[engine as Engine]
    : engine;
}
