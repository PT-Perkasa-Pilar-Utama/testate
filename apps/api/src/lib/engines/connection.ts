import type { Engine, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { EngineError } from "./types.ts";
import type { ConnectionConfig } from "./types.ts";

const DEFAULT_PORTS = { postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 } as const;
type SqlEngine = keyof typeof DEFAULT_PORTS;

function isSqlEngine(engine: Engine): engine is SqlEngine {
  return engine in DEFAULT_PORTS;
}

const fieldsSchema = v.object({
  host: v.string(),
  port: v.optional(v.number()),
  database: v.string(),
  user: v.string(),
  ssl: v.optional(v.picklist(["disable", "prefer", "require"]), "prefer"),
  schemas: v.optional(v.array(v.string())),
});

const SSL_MODES = new Map<string, ConnectionConfig["ssl"]>([
  ["disable", "disable"],
  ["prefer", "prefer"],
  ["require", "require"],
  ["verify-ca", "require"],
  ["verify-full", "require"],
]);

const URL_PROTOCOLS = {
  postgres: /^postgres(ql)?:$/,
  mysql: /^(mysql|mariadb):$/,
  mariadb: /^(mysql|mariadb):$/,
  mongodb: /^mongodb(\+srv)?:$/,
} as const satisfies Record<SqlEngine, RegExp>;

type UrlBase = { host: string; port: number; database: string; user: string; password: string };

function mongoFromUrl(url: URL, base: UrlBase): ConnectionConfig {
  return {
    engine: "mongodb",
    ...base,
    ssl: url.searchParams.get("tls") === "true" ? "require" : "disable",
    authSource: url.searchParams.get("authSource") ?? base.database,
  };
}

/** `postgres://user:pass@host:port/db?sslmode=` into the same shape the field form gives. */
function fromUrl(engine: SqlEngine, text: string): ConnectionConfig {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new EngineError("auth_failed", "connection string is not a URL");
  }
  const expected = URL_PROTOCOLS[engine];
  if (!expected.test(url.protocol)) {
    throw new EngineError("unsupported", `${url.protocol} is not a ${engine} URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.hostname === "" || database === "") {
    throw new EngineError("auth_failed", "connection string needs a host and a database");
  }
  const base: UrlBase = {
    host: decodeURIComponent(url.hostname),
    port: url.port === "" ? DEFAULT_PORTS[engine] : Number(url.port),
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  if (engine === "mongodb") return mongoFromUrl(url, base);
  return {
    engine,
    ...base,
    ssl: SSL_MODES.get(url.searchParams.get("sslmode") ?? "prefer") ?? "prefer",
  };
}

/**
 * Builds the decrypted connection config an engine takes from a stored adapter config and its
 * opened secrets (12 §12.8).
 */
export function toConnectionConfig(
  engine: Engine,
  config: JsonObject,
  secrets: Readonly<Record<string, string>>
): ConnectionConfig {
  if (!isSqlEngine(engine)) throw new EngineError("unsupported", `${engine} has no engine`);
  const connectionString = secrets["connection_string"];
  if (connectionString !== undefined) return fromUrl(engine, connectionString);
  const fields = v.safeParse(fieldsSchema, config);
  if (!fields.success) throw new EngineError("auth_failed", "adapter config is incomplete");
  return fromFields(engine, fields.output, secrets);
}

function fromFields(
  engine: SqlEngine,
  fields: v.InferOutput<typeof fieldsSchema>,
  secrets: Readonly<Record<string, string>>
): ConnectionConfig {
  const base = {
    host: fields.host,
    port: fields.port ?? DEFAULT_PORTS[engine],
    database: fields.database,
    user: fields.user,
    password: secrets["password"] ?? "",
    ssl: fields.ssl,
  };
  // ponytail: the field form has no authSource; `admin` fits the container default. Add a field if needed.
  if (engine === "mongodb") return { engine, ...base, authSource: "admin" };
  if (engine !== "postgres") return { engine, ...base };
  const out: ConnectionConfig = { engine, ...base };
  if (fields.schemas !== undefined) out.schemas = fields.schemas;
  return out;
}
