import type { AdapterKind, Engine, JsonObject } from "@testate/shared";
import { ENGINES } from "@testate/shared";

export type FieldType = "text" | "number" | "password" | "url" | "boolean";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
};

export type EngineForm = { kind: AdapterKind; label: string; config: Field[]; secrets: Field[] };

/** One badge tone per adapter status, shared by the list and the detail header. `disabled` reads as
 * a neutral grey by default; that hides the one state operators most need to notice, so it takes
 * the warning tone instead. */
export const STATUS_VARIANT = { ok: "success", error: "error", disabled: "warning" } as const;

export const MODE_OPTIONS = [
  { value: "sandbox", label: "sandbox (restores allowed)" },
  { value: "read_only", label: "read-only" },
] as const;

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
    label: "S3 bucket",
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
        label: "Endpoint (optional, for MinIO)",
        type: "url",
        placeholder: "https://minio.sit.internal:9000",
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

export const ENGINE_OPTIONS = ENGINES.map((engine) => ({
  value: engine,
  label: `${engine} · ${ENGINE_FORMS[engine].label}`,
}));

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
