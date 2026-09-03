import type { Preflight, State } from "@testate/shared";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { diffSchema, forceIntersection, tableKey } from "../../lib/engines/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AdapterManifest } from "../states/states.repository.ts";
import type { RestoreDeps } from "./checkouts.restore.ts";
import { toAppError } from "./checkouts.restore.ts";

type PreflightAdapter = Preflight["adapters"][number];

const LOCKING = {
  table: "Locks each table while it restores it.",
  row: "Locks rows as it replaces them. Other readers can see a half-restored table.",
  "per-operation": "Replaces each collection on its own. No restore is atomic across collections.",
} as const;

/** One adapter of the state against its live schema: drift, strategy, force preview (09 §9.1). */
async function preflightAdapter(
  deps: RestoreDeps,
  adapter: AdapterRecord,
  manifest: AdapterManifest,
  force: boolean
): Promise<PreflightAdapter> {
  const engine = deps.engines.require(adapter.engine);
  const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
  const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
  try {
    const probe = await engine.probe(config);
    const live = await engine.introspect({ connectionId: adapter.id, config }, []);
    const drift = diffSchema(manifest.introspection, live);
    const entry: PreflightAdapter = {
      adapter_id: adapter.id,
      name: adapter.name,
      engine: adapter.engine,
      included: true,
      removed: false,
      drift: drift.changed ? drift : null,
      strategy: probe.strategy,
      atomic: probe.strategy.transactional,
      locking_notice: LOCKING[probe.strategy.locking],
    };
    if (drift.changed && force) {
      const preview = forceIntersection(manifest.introspection, live);
      entry.force_preview = {
        skipped_tables: manifest.tables
          .filter((table) => !preview.tables.some((item) => tableKey(item) === tableKey(table)))
          .map((table) => ({ schema: table.schema, name: table.name })),
        skipped_columns: preview.skippedColumns.map((ref) => ({
          table: tableKey(ref.table),
          column: ref.column,
        })),
        defaulted_columns: preview.defaultedColumns.map((ref) => ({
          table: tableKey(ref.table),
          column: ref.column,
        })),
      };
    }
    return entry;
  } catch (cause: unknown) {
    throw toAppError(cause, adapter.id);
  } finally {
    await engine.evict(adapter.id);
  }
}

const UNTOUCHED_STRATEGY = {
  emptyMode: "truncate",
  foreignKeyHandling: "not-applicable",
  transactional: false,
  triggerDisable: false,
  locking: "table",
} as const;

/** A project adapter the state does not cover: reported as untouched, never probed (story 79). */
function untouched(adapter: AdapterRecord): PreflightAdapter {
  return {
    adapter_id: adapter.id,
    name: adapter.name,
    engine: adapter.engine,
    included: false,
    removed: false,
    drift: null,
    strategy: UNTOUCHED_STRATEGY,
    atomic: false,
    locking_notice: "Not in this state. Left as it is.",
  };
}

/** Removed adapters and adapters outside the request are reported, never probed (13 §13.1). */
export async function preflight(
  deps: RestoreDeps,
  state: State,
  manifests: AdapterManifest[],
  outside: AdapterRecord[],
  requested: string[] | undefined,
  force: boolean
): Promise<Preflight> {
  const adapters: PreflightAdapter[] = outside.map(untouched);
  for (const manifest of manifests) {
    const adapter = deps.adapters.byId(manifest.adapter_id);
    const wanted = requested === undefined || requested.includes(manifest.adapter_id);
    if (adapter === null || !wanted) {
      adapters.push({
        adapter_id: manifest.adapter_id,
        name: manifest.adapter_name,
        engine: manifest.engine,
        included: false,
        removed: adapter === null,
        drift: null,
        strategy: {
          emptyMode: "truncate",
          foreignKeyHandling: "not-applicable",
          transactional: false,
          triggerDisable: false,
          locking: "table",
        },
        atomic: false,
        locking_notice:
          adapter === null ? "The adapter was removed." : "Not part of this checkout.",
      });
      continue;
    }
    adapters.push(await preflightAdapter(deps, adapter, manifest, force));
  }
  return { state: { id: state.id, name: state.name }, stash_will_be_taken: true, adapters };
}
