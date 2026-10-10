/**
 * The `journald` adapter's config (#86; J1, J3 of docs/decisions/2026-10-10-journald.md): an SSH
 * login, as an SFTP adapter's, and named groups of systemd units.
 */
import { journaldConfigSchema, jsonObjectSchema } from "@testate/shared";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";
import { parseWith, validateSecrets } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import type { Secrets } from "./adapters.secrets.ts";

export function validateJournald(config: JsonObject, secrets: Secrets): ValidatedConfig {
  const parsed = parseWith(journaldConfigSchema, config);
  validateSecrets("journald", secrets);
  const target = { host: parsed.host, port: parsed.port ?? 22 };
  return {
    kind: "logs",
    tier: "logs",
    config: v.parse(jsonObjectSchema, { ...parsed, port: target.port }),
    target,
    targetHash: sha256(`journald|${target.host}|${target.port}|${parsed.user}`),
  };
}
