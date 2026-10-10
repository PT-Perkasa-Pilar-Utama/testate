/**
 * The `elasticsearch` adapter's config (#92; E1, E3 of docs/decisions/2026-10-10-elasticsearch.md):
 * the cluster's address, a login per `auth`, a CA, and one named index pattern and query per source.
 */
import { esConfigSchema, jsonObjectSchema } from "@testate/shared";
import type { EsConfig, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";
import { invalid, parseWith } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import { baseUrlTarget } from "./adapters.loki.ts";
import type { Secrets } from "./adapters.secrets.ts";

/** The one secret each login takes, or none. */
const SECRET_OF_AUTH = new Map<EsConfig["auth"], string | null>([
  ["none", null],
  ["basic", "password"],
  ["api_key", "api_key"],
  ["bearer", "bearer_token"],
]);

function validateLogin(config: EsConfig, secrets: Secrets): void {
  const wanted = SECRET_OF_AUTH.get(config.auth) ?? null;
  const unknown = Object.keys(secrets).find((key) => key !== wanted);
  if (unknown !== undefined)
    throw invalid(`secret ${unknown} is not used by elasticsearch with ${config.auth} auth`, {
      key: unknown,
    });
  if (wanted !== null && !(wanted in secrets))
    throw invalid(`${config.auth} auth needs the secret ${wanted}`, { key: wanted });
}

export function validateElasticsearch(config: JsonObject, secrets: Secrets): ValidatedConfig {
  const parsed = parseWith(esConfigSchema, config);
  validateLogin(parsed, secrets);
  const target = baseUrlTarget(parsed.url);
  return {
    kind: "logs",
    tier: "logs",
    config: v.parse(jsonObjectSchema, parsed),
    target,
    targetHash: sha256(`elasticsearch|${parsed.url}|${parsed.auth}|${parsed.user ?? ""}`),
  };
}
