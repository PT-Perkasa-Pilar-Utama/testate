/**
 * The `logfile` adapter's config (S1, docs/decisions/2026-10-10-logs-tier.md): one connection, SFTP
 * or S3, holding named sources. Its files open through the same resolver as a storage adapter's,
 * as the transport it names, so netguard and host-key trust are not written twice.
 */
import { jsonObjectSchema, logfileConfigSchema } from "@testate/shared";
import type { JsonObject, LogfileConfig } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";
import { parseWith, s3Target, validateSecrets } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import type { Secrets } from "./adapters.secrets.ts";

export function validateLogfile(config: JsonObject, secrets: Secrets): ValidatedConfig {
  const parsed: LogfileConfig = parseWith(logfileConfigSchema, config);
  // The secrets an SFTP host or an S3 bucket takes, exactly as a storage adapter of that kind.
  validateSecrets(parsed.transport, secrets);
  const target =
    parsed.transport === "s3" ? s3Target(parsed) : { host: parsed.host, port: parsed.port ?? 22 };
  const where = parsed.transport === "s3" ? `${parsed.bucket}|${parsed.prefix}` : parsed.root_path;
  return {
    kind: "logs",
    tier: "logs",
    config: v.parse(jsonObjectSchema, { ...parsed, port: target.port }),
    target,
    targetHash: sha256(`${parsed.transport}|${target.host}|${target.port}|${where}`),
  };
}

export type FileTarget = { engine: "sftp" | "s3"; config: JsonObject };

/** The storage engine and config a `logfile` adapter's files open as: its connection, no sources. */
export function fileTargetOf(config: LogfileConfig): FileTarget {
  const { sources: _sources, transport, ...connection } = config;
  return { engine: transport, config: v.parse(jsonObjectSchema, connection) };
}
