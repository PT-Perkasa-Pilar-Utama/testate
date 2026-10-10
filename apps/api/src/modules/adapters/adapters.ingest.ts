/**
 * The `ingest` adapter's config (#75; Q4b, I1–I9 of docs/decisions/2026-10-10-logs-tier.md): apps
 * push lines to Testate, so there is no target to dial, no secret in the draft, and no deny-list
 * check. Its token is minted on create and kept hashed in `ingest_tokens`.
 */
import { ingestConfigSchema, jsonObjectSchema } from "@testate/shared";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";
import { parseWith, validateSecrets } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import type { Secrets } from "./adapters.secrets.ts";

export function validateIngest(config: JsonObject, secrets: Secrets): ValidatedConfig {
  validateSecrets("ingest", secrets);
  const parsed = parseWith(ingestConfigSchema, config);
  return {
    kind: "logs",
    tier: "logs",
    config: v.parse(jsonObjectSchema, parsed),
    target: null,
    // One value for every ingest adapter: retention and cap are not a target, so an edit never
    // reads as a new one.
    targetHash: sha256("ingest"),
  };
}
