import type { JsonObject, ProbeOutcome } from "@testate/shared";

import type { KeyRing, Sealed } from "../../lib/sealed/index.ts";
import { validateConfig } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import type { AdapterConfigPatch, AdapterRecord } from "./adapters.repository.ts";
import {
  CONFIG_COLUMN,
  READONLY_COLUMN,
  mergeSecrets,
  openSecrets,
  sealSecrets,
} from "./adapters.secrets.ts";
import type { Secrets } from "./adapters.secrets.ts";

/** PATCH secrets: a new value, or "keep" for the stored one (05 §5.5). */
export type AdapterPatch = {
  name?: string;
  config?: JsonObject;
  secrets?: Secrets;
  readonly_secrets?: Secrets | null;
  excluded_tables?: string[];
  restore_mode?: "atomic" | "fast";
  lock_timeout_ms?: number;
};

export type PatchChange = {
  columns: AdapterConfigPatch;
  outcome: ProbeOutcome | null;
  newTarget: boolean;
  credentialReplaced: boolean;
};

export type PatchDeps = {
  ring: KeyRing;
  probe: (validated: ValidatedConfig, secrets: Secrets) => Promise<ProbeOutcome>;
  nowIso: () => string;
};

function plainColumns(patch: AdapterPatch): AdapterConfigPatch {
  const columns: AdapterConfigPatch = {};
  if (patch.name !== undefined) columns.name = patch.name;
  if (patch.excluded_tables !== undefined) columns.excluded_tables = patch.excluded_tables;
  if (patch.restore_mode !== undefined) columns.restore_mode = patch.restore_mode;
  if (patch.lock_timeout_ms !== undefined) columns.lock_timeout_ms = patch.lock_timeout_ms;
  return columns;
}

async function readonlyColumn(
  deps: PatchDeps,
  current: AdapterRecord,
  incoming: Secrets | null
): Promise<Sealed | null> {
  if (incoming === null) return null;
  const stored =
    current.readonly_config_sealed === null
      ? {}
      : await openSecrets(deps.ring, current.id, READONLY_COLUMN, current.readonly_config_sealed);
  return sealSecrets(deps.ring, current.id, READONLY_COLUMN, mergeSecrets(stored, incoming));
}

/**
 * Merges a PATCH over the stored row: "keep" secrets stay, a changed host, port, database, or secret
 * re-probes, and a new target hash asks for a new init state (05 §5.5).
 */
export async function applyPatch(
  deps: PatchDeps,
  current: AdapterRecord,
  patch: AdapterPatch
): Promise<PatchChange> {
  const columns = plainColumns(patch);
  const touchesTarget = patch.config !== undefined || patch.secrets !== undefined;
  if (!touchesTarget && patch.readonly_secrets === undefined) {
    return { columns, outcome: null, newTarget: false, credentialReplaced: false };
  }
  const stored = await openSecrets(deps.ring, current.id, CONFIG_COLUMN, current.config_sealed);
  const secrets = mergeSecrets(stored, patch.secrets);
  const credentialReplaced = Object.entries(secrets).some(([key, value]) => stored[key] !== value);
  const validated = validateConfig(
    current.engine,
    current.kind,
    patch.config ?? current.config,
    secrets
  );
  let outcome: ProbeOutcome | null = null;
  if (touchesTarget) {
    outcome = await deps.probe(validated, secrets);
    columns.config_public = validated.config;
    columns.target_hash = validated.targetHash;
  }
  if (credentialReplaced) {
    columns.config_sealed = await sealSecrets(deps.ring, current.id, CONFIG_COLUMN, secrets);
    columns.sealed_set_at = deps.nowIso();
  }
  if (patch.readonly_secrets !== undefined && current.kind === "database") {
    columns.readonly_config_sealed = await readonlyColumn(deps, current, patch.readonly_secrets);
  }
  return {
    columns,
    outcome,
    newTarget: touchesTarget && validated.targetHash !== current.target_hash,
    credentialReplaced,
  };
}
