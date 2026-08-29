import type { ErrorCode, TableRef } from "@testate/shared";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { EngineError, sameTable } from "../../lib/engines/index.ts";
import type { CheckoutResult, EngineErrorKind, EngineRegistry } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { decodeChunks } from "../../lib/snapshot/codec.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AdapterManifest, StatesRepository } from "../states/states.repository.ts";

export type ReturnToInitDeps = {
  engines: EngineRegistry;
  blobs: BlobStore;
  ring: KeyRing;
  adapters: AdaptersRepository;
  states: StatesRepository;
};

export type ReturnToInitAction = "restore" | "force";

const LOCK_TIMEOUT_MS = 5000;

const CODE_OF_KIND = new Map<EngineErrorKind, ErrorCode>([
  ["schema_drift", "SCHEMA_DRIFT"],
  ["checkout_blocked", "CHECKOUT_BLOCKED"],
  ["lock_timeout", "CHECKOUT_BLOCKED"],
  ["unreachable", "ADAPTER_UNREACHABLE"],
  ["auth_failed", "ADAPTER_UNREACHABLE"],
  ["unsupported", "ENGINE_UNSUPPORTED"],
  ["version_too_old", "ENGINE_UNSUPPORTED"],
  ["privilege_missing", "ENGINE_UNSUPPORTED"],
]);

/** Engine failures become the API's error codes; the message never carries the config (12 §12.8). */
export function toAppError(cause: unknown, adapterId: string): AppError {
  if (cause instanceof AppError) return cause;
  if (!(cause instanceof EngineError)) {
    return new AppError("INTERNAL", String(cause), { adapter_id: adapterId });
  }
  const details = { ...cause.details, adapter_id: adapterId, kind: cause.kind };
  return new AppError(CODE_OF_KIND.get(cause.kind) ?? "INTERNAL", cause.message, details, {
    retriable: cause.retriable,
  });
}

function blobFor(manifest: AdapterManifest, ref: TableRef): string | null {
  return manifest.tables.find((table) => sameTable(table, ref))?.blob_hash ?? null;
}

/**
 * Restores one adapter to its latest init state (13 §13.7): the §13.2 recipe with no stash and
 * no hooks. `force` restores the intersection on drift; `restore` refuses it.
 */
export async function returnToInit(
  deps: ReturnToInitDeps,
  adapterId: string,
  action: ReturnToInitAction,
  signal: AbortSignal
): Promise<CheckoutResult> {
  const adapter = deps.adapters.byId(adapterId);
  if (adapter === null)
    throw new AppError("NOT_FOUND", "adapter not found", { adapter_id: adapterId });
  const init = deps.states.latestInit(adapterId);
  if (init === null) {
    throw new AppError("CHECKOUT_BLOCKED", "the adapter has no ready init state", {
      adapter_id: adapterId,
    });
  }
  const engine = deps.engines.require(adapter.engine);
  const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
  const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
  const manifest = init.manifest;
  try {
    const run = engine.checkout(
      { connectionId: adapter.id, config },
      {
        tables: manifest.tables,
        introspectionAtSnapshot: manifest.introspection,
        rows: (ref) => {
          const hash = blobFor(manifest, ref);
          if (hash === null) throw new EngineError("batch_failed", `no blob for ${ref.name}`);
          return decodeChunks(deps.blobs.get(hash));
        },
        onDrift: action === "force" ? "force" : "fail",
        lockTimeoutMs: LOCK_TIMEOUT_MS,
        restoreMode: "atomic",
        signal,
      }
    );
    const result = await run.result;
    if (result.status !== "restored") {
      throw new AppError("CHECKOUT_BLOCKED", `restore ended ${result.status}`, {
        adapter_id: adapterId,
      });
    }
    return result;
  } catch (cause: unknown) {
    throw toAppError(cause, adapterId);
  } finally {
    await engine.evict(adapter.id);
  }
}
