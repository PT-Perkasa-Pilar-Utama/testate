import { errorCodeSchema } from "@testate/shared";
import * as v from "valibot";

import type { CheckoutResult } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import { restoreFromManifest } from "./checkouts.restore.ts";
import type { AdapterOutcome, RestoreDeps } from "./checkouts.restore.ts";

export type ReturnToInitDeps = RestoreDeps;
export type ReturnToInitAction = "restore" | "force";

export { toAppError } from "./checkouts.restore.ts";

/**
 * Restores one adapter to its latest init state (13 §13.7): the §13.2 recipe with no stash and
 * no hooks. `force` restores the intersection on drift; `restore` refuses it. Throws on any
 * outcome other than `restored`, so deletion stops before removing rows.
 */
export async function returnToInit(
  deps: ReturnToInitDeps,
  adapterId: string,
  action: ReturnToInitAction,
  signal: AbortSignal
): Promise<Pick<CheckoutResult, "tables" | "batches">> {
  const adapter = deps.adapters.byId(adapterId);
  if (adapter === null) {
    throw new AppError("NOT_FOUND", "adapter not found", { adapter_id: adapterId });
  }
  const init = deps.states.latestInit(adapterId);
  if (init === null) {
    throw new AppError("CHECKOUT_BLOCKED", "the adapter has no ready init state", {
      adapter_id: adapterId,
    });
  }
  const outcome: AdapterOutcome = await restoreFromManifest(deps, adapter, init.manifest, {
    force: action === "force",
    signal,
  });
  if (outcome.result !== "restored" || outcome.error !== null) {
    const error = outcome.error ?? { code: "INTERNAL", message: "restore did not finish" };
    const code = v.safeParse(errorCodeSchema, error.code);
    throw new AppError(code.success ? code.output : "INTERNAL", error.message, {
      ...error.details,
      adapter_id: adapterId,
      result: outcome.result,
    });
  }
  return {
    tables: init.manifest.tables.map((table) => ({
      ref: { schema: table.schema, name: table.name },
      rows: table.rows,
    })),
    batches: init.manifest.tables.length,
  };
}
