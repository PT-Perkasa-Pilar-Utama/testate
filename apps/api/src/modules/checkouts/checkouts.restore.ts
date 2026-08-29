import type { Checkout, ErrorCode, TableRef } from "@testate/shared";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { EngineError, sameTable, tableKey } from "../../lib/engines/index.ts";
import type {
  CheckoutResult,
  ColumnRef,
  CounterResult,
  EncodedRow,
  EngineErrorKind,
  EngineRegistry,
} from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { decodeChunks } from "../../lib/snapshot/codec.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AdapterManifest, StatesRepository } from "../states/states.repository.ts";

export type RestoreDeps = {
  engines: EngineRegistry;
  blobs: BlobStore;
  ring: KeyRing;
  adapters: AdaptersRepository;
  states: StatesRepository;
};

export type AdapterOutcome = Omit<
  Checkout["adapters"][number],
  "adapter_id" | "name" | "engine"
> & {
  counters: CounterResult[];
};

export type RestoreOptions = {
  force: boolean;
  signal: AbortSignal;
  onProgress?: (tablesDone: number, tablesTotal: number) => void;
};

const CODE_OF_KIND = new Map<EngineErrorKind, ErrorCode>([
  ["schema_drift", "SCHEMA_DRIFT"],
  ["checkout_blocked", "CHECKOUT_BLOCKED"],
  ["lock_timeout", "CHECKOUT_BLOCKED"],
  ["unreachable", "ADAPTER_UNREACHABLE"],
  ["auth_failed", "ADAPTER_UNREACHABLE"],
  ["unsupported", "ENGINE_UNSUPPORTED"],
  ["version_too_old", "ENGINE_UNSUPPORTED"],
  ["privilege_missing", "ENGINE_UNSUPPORTED"],
  // A statement the engine rejected (syntax, cast, constraint) or cancelled is the adapter's answer, never a 500 (06 §6.7).
  ["batch_failed", "ADAPTER_UNREACHABLE"],
  ["cancelled", "ADAPTER_UNREACHABLE"],
  ["document_too_large", "VALIDATION_ERROR"],
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

/** Drift leaves the adapter untouched (`skipped`); a failed transaction rolled back; the rest is unknown. */
function resultOf(cause: unknown): Checkout["adapters"][number]["result"] {
  if (!(cause instanceof EngineError)) return "unknown";
  if (cause.kind === "schema_drift") return "skipped";
  if (["checkout_blocked", "lock_timeout", "cancelled", "batch_failed"].includes(cause.kind)) {
    return "rolled_back";
  }
  return "unknown";
}

function columnRefs(refs: ColumnRef[]): { table: string; column: string }[] {
  return refs.map((ref) => ({ table: tableKey(ref.table), column: ref.column }));
}

function failed(cause: unknown, adapterId: string, startedAt: number): AdapterOutcome {
  const error = toAppError(cause, adapterId);
  return {
    result: resultOf(cause),
    strategy: null,
    rows: null,
    duration_ms: Date.now() - startedAt,
    lock_wait_ms: null,
    skipped_tables: [],
    skipped_columns: [],
    defaulted_columns: [],
    counters: [],
    error: { code: error.code, message: error.message, details: error.details ?? {} },
  };
}

function succeeded(result: CheckoutResult, startedAt: number): AdapterOutcome {
  const countersFailed = result.counters.some((counter) => !counter.ok);
  return {
    result: countersFailed ? "counters_failed" : "restored",
    strategy: result.strategy,
    rows: result.tables.reduce((total, table) => total + table.rows, 0),
    duration_ms: Date.now() - startedAt,
    lock_wait_ms: result.lockWaitMs,
    skipped_tables: result.skipped.tables,
    skipped_columns: columnRefs(result.skipped.columns),
    defaulted_columns: columnRefs(result.defaultedColumns),
    counters: result.counters,
    error: countersFailed
      ? { code: "CONFLICT", message: "one or more counters were not reset", details: {} }
      : null,
  };
}

/**
 * One adapter back to a manifest (13 §13.2 step 4): the engine's checkout with rows streamed from
 * the blob store. Never throws; every failure is an outcome the checkout row records.
 */
export async function restoreFromManifest(
  deps: RestoreDeps,
  adapter: AdapterRecord,
  manifest: AdapterManifest,
  opts: RestoreOptions
): Promise<AdapterOutcome> {
  const startedAt = Date.now();
  const engine = deps.engines.get(adapter.engine);
  if (engine === null) {
    return failed(
      new EngineError("unsupported", `${adapter.engine} has no engine`),
      adapter.id,
      startedAt
    );
  }
  try {
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
    const rows = (ref: TableRef): AsyncIterable<EncodedRow> => {
      const table = manifest.tables.find((item) => sameTable(item, ref));
      if (table === undefined) throw new EngineError("batch_failed", `no blob for ${ref.name}`);
      return decodeChunks(deps.blobs.get(table.blob_hash));
    };
    const run = engine.checkout(
      { connectionId: adapter.id, config },
      {
        tables: manifest.tables,
        introspectionAtSnapshot: manifest.introspection,
        rows,
        onDrift: opts.force ? "force" : "fail",
        lockTimeoutMs: adapter.lock_timeout_ms,
        restoreMode: adapter.restore_mode,
        signal: opts.signal,
      }
    );
    for await (const item of run) opts.onProgress?.(item.tablesDone, item.tablesTotal);
    const result = await run.result;
    if (result.status !== "restored") {
      return failed(
        new EngineError("batch_failed", `restore ended ${result.status}`),
        adapter.id,
        startedAt
      );
    }
    return succeeded(result, startedAt);
  } catch (cause: unknown) {
    return failed(cause, adapter.id, startedAt);
  } finally {
    await engine.evict(adapter.id);
  }
}
