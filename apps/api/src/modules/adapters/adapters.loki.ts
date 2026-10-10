/**
 * The `loki` adapter's config (#90; L1, L3 of docs/decisions/2026-10-10-loki.md): Loki's address,
 * a login per `auth`, a tenant, and one named LogQL log query per source.
 */
import { jsonObjectSchema, lokiConfigSchema } from "@testate/shared";
import type { JsonObject, LokiConfig } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";
import { invalid, parseWith } from "./adapters.config.ts";
import type { Target, ValidatedConfig } from "./adapters.config.ts";
import type { Secrets } from "./adapters.secrets.ts";

/** The one secret each login takes, or none. */
const SECRET_OF_AUTH = new Map<LokiConfig["auth"], string | null>([
  ["none", null],
  ["basic", "password"],
  ["bearer", "bearer_token"],
]);

function validateLogin(config: LokiConfig, secrets: Secrets): void {
  const wanted = SECRET_OF_AUTH.get(config.auth) ?? null;
  const unknown = Object.keys(secrets).find((key) => key !== wanted);
  if (unknown !== undefined)
    throw invalid(`secret ${unknown} is not used by loki with ${config.auth} auth`, {
      key: unknown,
    });
  if (wanted !== null && !(wanted in secrets))
    throw invalid(`${config.auth} auth needs the secret ${wanted}`, { key: wanted });
}

export function lokiTarget(url: string): Target {
  const parsed = new URL(url);
  const fallback = parsed.protocol === "https:" ? 443 : 80;
  return { host: parsed.hostname, port: parsed.port === "" ? fallback : Number(parsed.port) };
}

export function validateLoki(config: JsonObject, secrets: Secrets): ValidatedConfig {
  const parsed = parseWith(lokiConfigSchema, config);
  validateLogin(parsed, secrets);
  const target = lokiTarget(parsed.url);
  const login = `${parsed.auth}|${parsed.user ?? ""}|${parsed.tenant ?? ""}`;
  return {
    kind: "logs",
    tier: "logs",
    config: v.parse(jsonObjectSchema, parsed),
    target,
    targetHash: sha256(`loki|${parsed.url}|${login}`),
  };
}
