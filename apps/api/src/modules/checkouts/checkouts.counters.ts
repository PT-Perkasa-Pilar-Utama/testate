import type { Checkout } from "@testate/shared";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { conflict } from "../../lib/http/index.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AdapterCounters, CheckoutsRepository } from "./checkouts.repository.ts";
import type { RestoreDeps } from "./checkouts.restore.ts";
import { toAppError } from "./checkouts.restore.ts";

export type CountersDeps = RestoreDeps & { repo: CheckoutsRepository };

/** `repairCounters` for every `counters_failed` adapter; success turns the result `restored` (09 §9.6). */
export async function repairCounters(
  deps: CountersDeps,
  checkout: Checkout
): Promise<AdapterCounters[]> {
  const broken = checkout.adapters.filter((adapter) => adapter.result === "counters_failed");
  if (broken.length === 0) throw conflict("nothing to repair");
  const manifests = new Map(
    deps.states.manifestsOf(checkout.state.id).map((manifest) => [manifest.adapter_id, manifest])
  );
  const repaired: AdapterCounters[] = [];
  for (const entry of broken) {
    const adapter = deps.adapters.byId(entry.adapter_id);
    const manifest = manifests.get(entry.adapter_id);
    if (adapter === null || manifest === undefined) continue;
    const engine = deps.engines.require(adapter.engine);
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
    try {
      const report = await engine.repairCounters(
        { connectionId: adapter.id, config },
        manifest.tables.map((table) => ({ schema: table.schema, name: table.name }))
      );
      const ok = report.counters.every((counter) => counter.ok);
      deps.repo.setAdapterResult(checkout.id, adapter.id, {
        ...entry,
        result: ok ? "restored" : "counters_failed",
        counters: report.counters,
        error: ok ? null : entry.error,
      });
      repaired.push({ adapter_id: adapter.id, counters: report.counters });
    } catch (cause: unknown) {
      throw toAppError(cause, adapter.id);
    } finally {
      await engine.evict(adapter.id);
    }
  }
  return repaired;
}
