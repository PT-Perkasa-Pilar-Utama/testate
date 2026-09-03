import type { Adapter, AdapterKind, AdapterMode, Engine, JsonObject, Tier } from "@testate/shared";
import { ADAPTER_MODES, ADAPTER_STATUSES, ENGINES, TIERS } from "@testate/shared";

import {
  ADAPTER_MODE_LABEL,
  ADAPTER_STATUS_LABEL,
  ENGINE_LABEL,
  TIER_LABEL,
} from "@/lib/labels.ts";

export type FieldType = "text" | "number" | "password" | "url" | "boolean";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** One sentence under the field, for a rule an example cannot carry. */
  hint?: string;
};

export type EngineForm = { kind: AdapterKind; label: string; config: Field[]; secrets: Field[] };

/** One badge tone per adapter status, shared by the list and the detail header. `disabled` reads as
 * a neutral grey by default; that hides the one state operators most need to notice, so it takes
 * the warning tone instead. */
export const STATUS_VARIANT = { ok: "success", error: "error", disabled: "warning" } as const;

const HOST_PORT = (port: number): Field[] => [
  { key: "host", label: "Host", type: "text", required: true, placeholder: "db.sit.internal" },
  { key: "port", label: "Port", type: "number", placeholder: String(port) },
];

const DATABASE = (port: number): EngineForm => ({
  kind: "database",
  label: "database",
  config: [
    ...HOST_PORT(port),
    { key: "database", label: "Database", type: "text", required: true },
    { key: "user", label: "User", type: "text", required: true },
  ],
  secrets: [{ key: "password", label: "Password", type: "password", required: true }],
});

/** Fields per engine (05 draft body). Secrets are sent once and sealed; the form never shows them again. */
export const ENGINE_FORMS = {
  postgres: DATABASE(5432),
  mysql: DATABASE(3306),
  mariadb: DATABASE(3306),
  mongodb: DATABASE(27017),
  s3: {
    kind: "storage",
    label: "Object storage",
    config: [
      { key: "bucket", label: "Bucket", type: "text", required: true },
      {
        key: "region",
        label: "Region",
        type: "text",
        required: true,
        placeholder: "ap-southeast-1",
      },
      { key: "prefix", label: "Prefix", type: "text", placeholder: "exports/" },
      {
        key: "endpoint",
        // Not "for MinIO". This one field is the whole of supporting every other S3-compatible
        // store: Cloudflare R2, Google Cloud Storage through its interoperability API, Backblaze
        // B2, Wasabi, Ceph. Leave it empty for Amazon's own S3.
        label: "Endpoint",
        type: "url",
        placeholder: "https://s3.example.internal:9000",
        hint: "Leave empty for Amazon S3. Every other store needs its address.",
      },
      {
        key: "virtual_hosted",
        // Amazon deprecated path-style addressing for buckets made after September 2020, and
        // every other store here wants path-style. The default is off because that is what the
        // stores people point this at want; an Amazon bucket turns it on.
        label: "Bucket in the hostname: on for Amazon S3, off for every other store",
        type: "boolean",
      },
    ],
    secrets: [
      { key: "access_key_id", label: "Access key id", type: "password", required: true },
      { key: "secret_access_key", label: "Secret access key", type: "password", required: true },
    ],
  },
  sftp: {
    kind: "storage",
    label: "SFTP",
    config: [
      ...HOST_PORT(22),
      { key: "user", label: "User", type: "text", required: true },
      { key: "root_path", label: "Root path", type: "text", placeholder: "/" },
    ],
    secrets: [{ key: "password", label: "Password", type: "password", required: true }],
  },
  ftp: {
    kind: "storage",
    label: "FTP",
    config: [
      ...HOST_PORT(21),
      { key: "user", label: "User", type: "text", required: true },
      { key: "root_path", label: "Root path", type: "text", placeholder: "/" },
    ],
    secrets: [{ key: "password", label: "Password", type: "password", required: true }],
  },
} as const satisfies Record<Engine, EngineForm>;

// Neither type is exported from the shared package (labels.ts derives AdapterStatus the same way);
// the picklist values are the only shape the filter panel needs.
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];

/** What the adapter list can be narrowed by. `""` means every value passes. */
export type AdapterFilters = {
  engine: Engine | "";
  tier: Tier | "";
  mode: AdapterMode | "";
  status: AdapterStatus | "";
};
export const ADAPTER_FILTERS_EMPTY: AdapterFilters = { engine: "", tier: "", mode: "", status: "" };

export const ENGINE_FILTER_OPTIONS: { value: Engine | ""; label: string }[] = [
  { value: "", label: "All engines" },
  ...ENGINES.map((value) => ({ value, label: ENGINE_LABEL[value] })),
];
export const TIER_FILTER_OPTIONS: { value: Tier | ""; label: string }[] = [
  { value: "", label: "All tiers" },
  ...TIERS.map((value) => ({ value, label: TIER_LABEL[value] })),
];
export const ADAPTER_MODE_FILTER_OPTIONS: { value: AdapterMode | ""; label: string }[] = [
  { value: "", label: "All modes" },
  ...ADAPTER_MODES.map((value) => ({ value, label: ADAPTER_MODE_LABEL[value] })),
];
export const ADAPTER_STATUS_FILTER_OPTIONS: { value: AdapterStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  ...ADAPTER_STATUSES.map((value) => ({ value, label: ADAPTER_STATUS_LABEL[value] })),
];

/** Every filter with a value set must match; `""` never excludes a row. */
export function matchesAdapterFilters(
  adapter: Pick<Adapter, "engine" | "tier" | "mode" | "status">,
  filters: AdapterFilters
): boolean {
  if (filters.engine !== "" && adapter.engine !== filters.engine) return false;
  if (filters.tier !== "" && adapter.tier !== filters.tier) return false;
  if (filters.mode !== "" && adapter.mode !== filters.mode) return false;
  if (filters.status !== "" && adapter.status !== filters.status) return false;
  return true;
}

export type Values = Record<string, string>;

/** Turns form strings into the draft body: numbers parsed, blanks dropped, kind derived from the engine. */
export function toDraftBody(
  engine: Engine,
  name: string,
  mode: "sandbox" | "read_only",
  values: Values
): JsonObject {
  const form: EngineForm = ENGINE_FORMS[engine];
  const config: JsonObject = {};
  for (const field of form.config) {
    const raw = values[`config.${field.key}`] ?? "";
    // A tick is a value even when it is off, unlike an empty text box, which means "not set".
    if (field.type === "boolean") {
      config[field.key] = raw === "true";
      continue;
    }
    if (raw === "") continue;
    config[field.key] = field.type === "number" ? Number(raw) : raw;
  }
  const secrets: JsonObject = {};
  for (const field of form.secrets) {
    const raw = values[`secret.${field.key}`] ?? "";
    if (raw !== "") secrets[field.key] = raw;
  }
  return { kind: form.kind, engine, name: name.trim(), mode, config, secrets };
}

/**
 * Every required config/secret field the create draft left blank, by label. ENGINE_FORMS keys are
 * decided at runtime, so Formisch's schema cannot cover them (`createForm` throws on a `record`
 * schema); the create dialog checks them by hand in their place, the way the old form guard did.
 */
export function missingRequiredFields(engine: Engine, values: Values): string[] {
  const form: EngineForm = ENGINE_FORMS[engine];
  const sections: [string, Field[]][] = [
    ["config", form.config],
    ["secret", form.secrets],
  ];
  const missing: string[] = [];
  for (const [prefix, fields] of sections) {
    for (const field of fields) {
      if (field.required === true && (values[`${prefix}.${field.key}`] ?? "") === "") {
        missing.push(field.label);
      }
    }
  }
  return missing;
}
