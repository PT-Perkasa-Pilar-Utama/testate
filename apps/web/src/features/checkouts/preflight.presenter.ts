import { createSignal } from "solid-js";
import type { Preflight, SchemaDrift, State } from "@testate/shared";

import { showToast } from "@/lib/toast.ts";
import { followJob } from "@/lib/sse.ts";
import { checkoutsModel } from "./checkouts.model.ts";

export type PreflightAdapter = Preflight["adapters"][number];

export type PreflightPresenter = {
  target: () => State | null;
  preflight: () => Preflight | null;
  force: () => boolean;
  busy: () => boolean;
  error: () => string | null;
  ready: () => boolean;
  /** True while schema drift is the only thing standing between here and Check out. */
  blocked: () => boolean;
  open: (state: State) => Promise<void>;
  close: () => void;
  setForce: (force: boolean) => Promise<void>;
  confirm: () => Promise<void>;
};

/** "2 tables added · 1 column removed" or "" when nothing drifted (story 77). */
export function driftSummary(drift: SchemaDrift | null): string {
  if (drift === null || !drift.changed) return "";
  const parts = [
    [drift.tables.added.length, "tables added"],
    [drift.tables.removed.length, "tables removed"],
    [drift.columns.added.length, "columns added"],
    [drift.columns.removed.length, "columns removed"],
    [drift.columns.type_changed.length, "types changed"],
    [drift.columns.nullability_changed.length, "nullability changed"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(" · ");
}

/** The included, still-present adapters whose live schema drifted from this state (story 77). */
export function driftedAdapters(preflight: Preflight): PreflightAdapter[] {
  return preflight.adapters.filter(
    (adapter) => adapter.included && !adapter.removed && driftSummary(adapter.drift) !== ""
  );
}

/** A checkout may start when no included adapter drifted, or force is on (stories 77, 78). */
export function canCheckout(preflight: Preflight, force: boolean): boolean {
  return force || driftedAdapters(preflight).length === 0;
}

/** "truncate · session-disable FKs · atomic" (stories 82, 84). */
export function strategyLine(adapter: PreflightAdapter): string {
  return [
    adapter.strategy.emptyMode,
    `${adapter.strategy.foreignKeyHandling} FKs`,
    adapter.atomic ? "atomic" : "not atomic",
  ].join(" · ");
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "request failed";
}

export function createPreflightPresenter(
  slug: () => string,
  onQueued: () => void
): PreflightPresenter {
  const [target, setTarget] = createSignal<State | null>(null);
  const [preflight, setPreflight] = createSignal<Preflight | null>(null);
  const [force, setForceSignal] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const load = async (staticSlug: string, state: State, staticForce: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setPreflight(
        await checkoutsModel.preflight(staticSlug, { state_id: state.id, force: staticForce })
      );
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const close = (): void => {
    setTarget(null);
    setPreflight(null);
    setForceSignal(false);
    setError(null);
  };
  return {
    target,
    preflight,
    force,
    busy,
    error,
    ready: () => {
      const current = preflight();
      return !busy() && current !== null && canCheckout(current, force());
    },
    blocked: () => {
      const current = preflight();
      return current !== null && !force() && !canCheckout(current, false);
    },
    open: (state) => {
      setTarget(state);
      setPreflight(null);
      setForceSignal(false);
      return load(slug(), state, false);
    },
    close,
    setForce: (next) => {
      const state = target();
      setForceSignal(next);
      return state === null ? Promise.resolve() : load(slug(), state, next);
    },
    confirm: async () => {
      const staticState = target();
      const staticSlug = slug();
      const staticForce = force();
      if (staticState === null) return;
      setBusy(true);
      setError(null);
      try {
        const { job } = await checkoutsModel.create(staticSlug, {
          state_id: staticState.id,
          force: staticForce,
        });
        close();
        showToast(`Checkout of ${staticState.name} queued`, "info");
        onQueued();
        followJob(job, (done) => {
          showToast(
            done.status === "succeeded"
              ? `Checked out ${staticState.name}`
              : `Checkout of ${staticState.name} ${done.status}`,
            done.status === "succeeded" ? "success" : "error"
          );
          onQueued();
        });
      } catch (cause: unknown) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
  };
}
