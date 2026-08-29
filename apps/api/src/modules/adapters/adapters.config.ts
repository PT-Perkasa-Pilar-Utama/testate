import type { AdapterKind, Engine, JsonObject, Tier } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import { sha256 } from "../../lib/password/index.ts";
import type { Secrets } from "./adapters.secrets.ts";

/** Which kind each engine belongs to; the draft's `kind` must agree (05 draft body). */
export const KIND_OF_ENGINE = {
  postgres: "database",
  mysql: "database",
  mariadb: "database",
  mongodb: "database",
  s3: "storage",
  sftp: "storage",
  ftp: "storage",
  http: "rest",
} as const satisfies Record<Engine, AdapterKind>;

export const TIER_OF_ENGINE = {
  postgres: "tabular",
  mysql: "tabular",
  mariadb: "tabular",
  mongodb: "document",
  s3: "files",
  sftp: "files",
  ftp: "files",
  http: "files",
} as const satisfies Record<Engine, Tier>;

const DEFAULT_PORT = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017,
  s3: 443,
  sftp: 22,
  ftp: 21,
  http: 443,
} as const satisfies Record<Engine, number>;

const port = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535));
const text = v.pipe(v.string(), v.minLength(1), v.maxLength(512));

const databaseConfigSchema = v.union([
  v.object({
    host: text,
    port: v.optional(port),
    database: text,
    user: text,
    ssl: v.optional(v.picklist(["disable", "prefer", "require"]), "prefer"),
    schemas: v.optional(v.array(text)),
  }),
  v.object({ connection_string_set: v.literal(true) }),
]);

export const s3ConfigSchema = v.object({
  bucket: text,
  prefix: v.optional(v.string(), ""),
  region: text,
  endpoint: v.optional(v.pipe(v.string(), v.url())),
  virtual_hosted: v.optional(v.boolean(), false),
});

export const fileHostConfigSchema = v.object({
  host: text,
  port: v.optional(port),
  user: text,
  root_path: v.optional(v.string(), "/"),
  tls: v.optional(v.boolean(), false),
});

const httpConfigSchema = v.object({
  base_url: v.pipe(v.string(), v.url()),
  timeout_ms: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1000), v.maxValue(120000)),
    30000
  ),
  verify_tls: v.optional(v.boolean(), true),
  default_headers: v.optional(v.record(v.string(), v.string()), {}),
});

/** Secret keys each engine accepts; `alternatives` lists groups of which exactly one is required. */
type SecretRule = { allowed: readonly string[]; alternatives: readonly (readonly string[])[] };

const SECRET_RULES = {
  postgres: {
    allowed: ["password", "connection_string"],
    alternatives: [["password", "connection_string"]],
  },
  mysql: {
    allowed: ["password", "connection_string"],
    alternatives: [["password", "connection_string"]],
  },
  mariadb: {
    allowed: ["password", "connection_string"],
    alternatives: [["password", "connection_string"]],
  },
  mongodb: {
    allowed: ["password", "connection_string"],
    alternatives: [["password", "connection_string"]],
  },
  s3: {
    allowed: ["access_key_id", "secret_access_key"],
    alternatives: [["access_key_id"], ["secret_access_key"]],
  },
  sftp: {
    allowed: ["password", "private_key", "passphrase"],
    alternatives: [["password", "private_key"]],
  },
  ftp: { allowed: ["password"], alternatives: [["password"]] },
  http: { allowed: [], alternatives: [] },
} as const satisfies Record<Engine, SecretRule>;

export type Target = { host: string; port: number };

export type ValidatedConfig = {
  kind: AdapterKind;
  tier: Tier;
  config: JsonObject;
  target: Target;
  targetHash: string;
};

function invalid(message: string, details: JsonObject = {}): AppError {
  return new AppError("VALIDATION_ERROR", message, details);
}

function parseWith<TSchema extends v.GenericSchema>(
  schema: TSchema,
  config: JsonObject
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, config);
  if (!result.success) {
    throw invalid("config does not match the engine", {
      issues: result.issues.map(
        (issue) =>
          `${issue.path?.map((p) => String(p.key)).join(".") ?? "config"}: ${issue.message}`
      ),
    });
  }
  return result.output;
}

/** Validates the secret keys for the engine; `http` accepts any header names. */
export function validateSecrets(engine: Engine, secrets: Secrets): void {
  const rules: SecretRule = SECRET_RULES[engine];
  if (engine === "http") return;
  const unknown = Object.keys(secrets).find((key) => !rules.allowed.includes(key));
  if (unknown !== undefined)
    throw invalid(`secret ${unknown} is not used by ${engine}`, { key: unknown });
  for (const group of rules.alternatives) {
    const present = group.filter((key) => key in secrets);
    if (present.length !== 1) {
      throw invalid(`exactly one of ${group.join(", ")} is required for ${engine}`, {
        keys: [...group],
      });
    }
  }
}

function hostOfUrl(raw: string, fallbackPort: number): Target {
  const url = new URL(raw);
  return { host: url.hostname, port: url.port === "" ? fallbackPort : Number(url.port) };
}

function databaseTarget(
  engine: Engine,
  config: v.InferOutput<typeof databaseConfigSchema>,
  secrets: Secrets
): Target {
  if ("host" in config) return { host: config.host, port: config.port ?? DEFAULT_PORT[engine] };
  const raw = secrets["connection_string"];
  if (raw === undefined) throw invalid("connection_string_set needs the connection_string secret");
  try {
    return hostOfUrl(raw, DEFAULT_PORT[engine]);
  } catch {
    throw invalid("connection_string is not a URL");
  }
}

function s3Target(config: v.InferOutput<typeof s3ConfigSchema>): Target {
  return config.endpoint === undefined
    ? { host: `s3.${config.region}.amazonaws.com`, port: 443 }
    : hostOfUrl(config.endpoint, 443);
}

/**
 * Validates the public config for the engine, checks the secret keys, and derives the network target
 * plus the target hash that decides whether a change needs a new init state (05 §5.5).
 */
export function validateConfig(
  engine: Engine,
  kind: AdapterKind,
  config: JsonObject,
  secrets: Secrets
): ValidatedConfig {
  if (KIND_OF_ENGINE[engine] !== kind)
    throw invalid(`engine ${engine} is not a ${kind} adapter`, { engine, kind });
  validateSecrets(engine, secrets);
  const tier = TIER_OF_ENGINE[engine];
  if (kind === "database") {
    const parsed = parseWith(databaseConfigSchema, config);
    const target = databaseTarget(engine, parsed, secrets);
    const database =
      "database" in parsed ? parsed.database : sha256(secrets["connection_string"] ?? "");
    return {
      kind,
      tier,
      config: v.parse(jsonObjectSchema, parsed),
      target,
      targetHash: sha256(`${target.host}|${target.port}|${database}`),
    };
  }
  if (engine === "s3") {
    const parsed = parseWith(s3ConfigSchema, config);
    const target = s3Target(parsed);
    return {
      kind,
      tier,
      config: v.parse(jsonObjectSchema, parsed),
      target,
      targetHash: sha256(`${target.host}|${parsed.bucket}|${parsed.prefix}`),
    };
  }
  if (engine === "http") {
    const parsed = parseWith(httpConfigSchema, config);
    const target = hostOfUrl(parsed.base_url, parsed.base_url.startsWith("http:") ? 80 : 443);
    return {
      kind,
      tier,
      config: { ...parsed, secret_header_names: Object.keys(secrets) },
      target,
      targetHash: sha256(parsed.base_url),
    };
  }
  const parsed = parseWith(fileHostConfigSchema, config);
  const target = { host: parsed.host, port: parsed.port ?? DEFAULT_PORT[engine] };
  return {
    kind,
    tier,
    config: { ...parsed, port: target.port },
    target,
    targetHash: sha256(`${target.host}|${target.port}|${parsed.root_path}`),
  };
}
