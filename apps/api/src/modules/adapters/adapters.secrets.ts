import * as v from "valibot";

import { conflict } from "../../lib/http/index.ts";
import { open, seal } from "../../lib/sealed/index.ts";
import type { KeyRing, Sealed } from "../../lib/sealed/index.ts";
import { aadFor } from "../../lib/sealed/registry.ts";

export const secretsSchema = v.record(v.string(), v.string());
/** Secret fields per engine (password, connection string, keys, header values); never returned. */
export type Secrets = v.InferOutput<typeof secretsSchema>;

export const CONFIG_COLUMN = "config_sealed";
export const READONLY_COLUMN = "readonly_config_sealed";

/** Seals one adapter's secrets as JSON, bound to its row and column (17 §17.4). */
export function sealSecrets(
  ring: KeyRing,
  id: string,
  column: string,
  secrets: Secrets
): Promise<Sealed> {
  return seal(ring, JSON.stringify(secrets), aadFor("adapters", column, id));
}

/** Opens stored secrets; a value no listed key opens asks for re-entry (17 §17.6). */
export async function openSecrets(
  ring: KeyRing,
  id: string,
  column: string,
  sealed: Sealed
): Promise<Secrets> {
  try {
    return v.parse(
      secretsSchema,
      JSON.parse(await open(ring, sealed, aadFor("adapters", column, id)))
    );
  } catch {
    throw conflict("this adapter's secrets cannot be read with the current key; re-enter them", {
      adapter_id: id,
    });
  }
}

/** `"keep"` takes the stored value; anything else replaces it; absent keys are dropped (05 §5.5). */
export function mergeSecrets(stored: Secrets, incoming: Secrets | undefined): Secrets {
  if (incoming === undefined) return { ...stored };
  const merged: Secrets = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== "keep") {
      merged[key] = value;
      continue;
    }
    const kept = stored[key];
    if (kept !== undefined) merged[key] = kept;
  }
  return merged;
}
