import { join } from "node:path";
import type { JsonValue, Sealed as SealedPublic, Settings } from "@testate/shared";
import * as v from "valibot";

import { createLocalBlobStore, createS3BlobStore } from "../../lib/blobstore/index.ts";
import type { BlobStore, S3StoreConfig } from "../../lib/blobstore/index.ts";
import type { Config } from "../../lib/config/index.ts";
import { conflict } from "../../lib/http/index.ts";
import { isSealed, kidOfSealed, open, seal } from "../../lib/sealed/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { aadFor } from "../../lib/sealed/registry.ts";
import type { MetadataDb } from "../../lib/db/index.ts";
import { createSettingsRepository } from "./settings.repository.ts";
import type { SettingsRepository } from "./settings.repository.ts";

/** The two sealed settings keys (17 §17.4); the sweep in `lib/sealed/registry.ts` lists them too. */
export const SEALED_SETTINGS_KEYS = [
  "store.s3.access_key_id",
  "store.s3.secret_access_key",
] as const;

export type StoreTarget = { driver: "local" } | { driver: "s3"; s3: S3StoreConfig };

/** Builds a blob store for a target; tests inject a memory-backed one. */
export type StoreFactory = (target: StoreTarget) => BlobStore;

const publicS3 = v.object({
  bucket: v.string(),
  prefix: v.string(),
  region: v.nullable(v.string()),
  endpoint: v.nullable(v.string()),
  virtual_hosted: v.boolean(),
});

export function createStoreFactory(config: Config): StoreFactory {
  return (target) =>
    target.driver === "local"
      ? createLocalBlobStore(join(config.TESTATE_DATA_DIR, "blobs"))
      : createS3BlobStore(target.s3);
}

/** `TESTATE_STORE=s3` builds the store from the environment and locks the settings (11 §11.2). */
export function envStoreTarget(config: Config): StoreTarget | null {
  if (config.TESTATE_STORE === undefined) return null;
  if (config.TESTATE_STORE === "local") return { driver: "local" };
  return {
    driver: "s3",
    s3: {
      bucket: config.TESTATE_S3_BUCKET ?? "",
      prefix: config.TESTATE_S3_PREFIX,
      region: config.TESTATE_S3_REGION ?? null,
      endpoint: config.TESTATE_S3_ENDPOINT ?? null,
      virtual_hosted: config.TESTATE_S3_VIRTUAL_HOSTED,
      access_key_id: config.TESTATE_S3_ACCESS_KEY_ID ?? "",
      secret_access_key: config.TESTATE_S3_SECRET_ACCESS_KEY ?? "",
    },
  };
}

function sealedValue(values: Map<string, JsonValue>, key: string): string | null {
  const value = values.get(key);
  return v.is(v.string(), value) && isSealed(value) ? value : null;
}

/** The public `store` block: config in the clear, keys as sealed markers. */
export function publicStore(
  values: Map<string, JsonValue>,
  driver: "local" | "s3"
): Settings["store"] {
  const config = v.safeParse(publicS3, values.get("store.s3"));
  if (!config.success) return { driver, s3: null, locked_by_env: false };
  const setAt = v.parse(v.optional(v.string(), ""), values.get("store.s3.set_at"));
  const marker = (key: string): SealedPublic => {
    const sealed = sealedValue(values, key);
    // SAFETY: sealedValue returns only strings that passed isSealed.
    return sealed === null
      ? { set: false }
      : {
          set: true,
          set_at: setAt,
          key_fingerprint: kidOfSealed(sealed as Parameters<typeof kidOfSealed>[0]),
        };
  };
  return {
    driver,
    s3: {
      ...config.output,
      access_key_id: marker("store.s3.access_key_id"),
      secret_access_key: marker("store.s3.secret_access_key"),
    },
    locked_by_env: false,
  };
}

/** Opens the stored S3 target; a key no configured secret opens asks for re-entry (17 §17.6). */
export async function storedS3Target(
  values: Map<string, JsonValue>,
  ring: KeyRing
): Promise<S3StoreConfig | null> {
  const config = v.safeParse(publicS3, values.get("store.s3"));
  if (!config.success) return null;
  const openKey = async (key: string): Promise<string> => {
    const sealed = sealedValue(values, key);
    if (sealed === null) throw conflict(`store_credential_missing: ${key} is not set`, { key });
    try {
      // SAFETY: sealedValue returns only strings that passed isSealed.
      return await open(
        ring,
        sealed as Parameters<typeof open>[1],
        aadFor("settings", key, "global")
      );
    } catch {
      throw conflict("the stored S3 keys cannot be read with the current key; re-enter them", {
        key,
      });
    }
  };
  return {
    ...config.output,
    access_key_id: await openKey("store.s3.access_key_id"),
    secret_access_key: await openKey("store.s3.secret_access_key"),
  };
}

export type S3Input = v.InferOutput<typeof publicS3> & {
  access_key_id: string;
  secret_access_key: string;
};

/** Writes the S3 config in the clear and both keys sealed; `"keep"` leaves a stored key as is. */
export async function writeS3Settings(
  repo: SettingsRepository,
  ring: KeyRing,
  input: S3Input,
  updatedBy: string,
  at: string
): Promise<void> {
  const { access_key_id, secret_access_key, ...config } = input;
  const keys: [string, string][] = [
    ["store.s3.access_key_id", access_key_id],
    ["store.s3.secret_access_key", secret_access_key],
  ];
  const entries: [string, JsonValue][] = [["store.s3", config]];
  for (const [key, value] of keys) {
    if (value === "keep") continue;
    entries.push([key, await seal(ring, value, aadFor("settings", key, "global"))]);
  }
  entries.push(["store.s3.set_at", at]);
  // One transaction: a reader that saw a sealed key without its `set_at` got a 500 (17 §17.6).
  repo.setMany(entries, updatedBy, at);
}

/** The store at boot: the environment wins; otherwise the stored driver, opening the sealed keys. */
export async function bootStoreTarget(
  config: Config,
  db: MetadataDb,
  ring: KeyRing
): Promise<StoreTarget> {
  const env = envStoreTarget(config);
  if (env !== null) return env;
  const values = createSettingsRepository(db).all();
  if (values.get("store.driver") !== "s3") return { driver: "local" };
  const s3 = await storedS3Target(values, ring);
  if (s3 === null) throw conflict("store.driver is s3 but store.s3 is not configured");
  return { driver: "s3", s3 };
}
