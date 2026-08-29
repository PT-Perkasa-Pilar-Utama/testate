import type { Engine, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { EngineError } from "./types.ts";
import type { ConnectionConfig } from "./types.ts";

const DEFAULT_PORT = 5432;

const fieldsSchema = v.object({
  host: v.string(),
  port: v.optional(v.number(), DEFAULT_PORT),
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

/** `postgres://user:pass@host:port/db?sslmode=` into the same shape the field form gives. */
function fromUrl(text: string): ConnectionConfig {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new EngineError("auth_failed", "connection string is not a URL");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new EngineError("unsupported", `${url.protocol} is not a postgres URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.hostname === "" || database === "") {
    throw new EngineError("auth_failed", "connection string needs a host and a database");
  }
  return {
    engine: "postgres",
    host: decodeURIComponent(url.hostname),
    port: url.port === "" ? DEFAULT_PORT : Number(url.port),
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: SSL_MODES.get(url.searchParams.get("sslmode") ?? "prefer") ?? "prefer",
  };
}

/**
 * Builds the decrypted connection config an engine takes from a stored adapter config and its
 * opened secrets (12 §12.8). Only postgres has an engine in this build.
 */
export function toConnectionConfig(
  engine: Engine,
  config: JsonObject,
  secrets: Readonly<Record<string, string>>
): ConnectionConfig {
  if (engine !== "postgres") throw new EngineError("unsupported", `${engine} has no engine`);
  const connectionString = secrets["connection_string"];
  if (connectionString !== undefined) return fromUrl(connectionString);
  const fields = v.safeParse(fieldsSchema, config);
  if (!fields.success) throw new EngineError("auth_failed", "adapter config is incomplete");
  const out: ConnectionConfig = {
    engine: "postgres",
    host: fields.output.host,
    port: fields.output.port,
    database: fields.output.database,
    user: fields.output.user,
    password: secrets["password"] ?? "",
    ssl: fields.output.ssl,
  };
  if (fields.output.schemas !== undefined) out.schemas = fields.output.schemas;
  return out;
}
