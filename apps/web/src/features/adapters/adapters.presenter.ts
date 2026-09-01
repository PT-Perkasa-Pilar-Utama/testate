import { createSignal } from "solid-js";
import type { Adapter, AdapterCreateFormInput } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import { createTableView } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Refreshable } from "@/lib/async.ts";
import { missingRequiredFields, toDraftBody } from "./adapters.fields.ts";
import type { Values } from "./adapters.fields.ts";
import { adaptersModel } from "./adapters.model.ts";
import type { ProbeOutcome } from "./adapters.model.ts";

/**
 * `engine`, `name` and `mode` live in the Formisch form now (`adapterCreateFormSchema`); this only
 * holds what the form cannot: the per-engine config/secret values (their keys are decided at
 * runtime by `ENGINE_FORMS`, so no static schema can own them) and what the server answers.
 */
export type AdapterSort = "name" | "engine" | "tier" | "mode" | "status";

export type AdaptersPresenter = Refreshable<Adapter[]> & {
  table: TableView<Adapter, AdapterSort>;
  creating: () => boolean;
  values: () => Values;
  outcome: () => ProbeOutcome | null;
  error: () => string | null;
  busy: () => boolean;
  openCreate: () => void;
  closeCreate: () => void;
  /** Call when the engine changes: a prior test outcome no longer describes what's selected. */
  invalidateOutcome: () => void;
  setValue: (key: string, value: string) => void;
  test: (input: AdapterCreateFormInput) => Promise<void>;
  create: (input: AdapterCreateFormInput) => Promise<void>;
};

/** A probe outcome as one line for the test banner. */
export function describeOutcome(outcome: ProbeOutcome): string {
  if ("reachable" in outcome) return `${outcome.engine} reachable (${outcome.tier} tier)`;
  return `${outcome.dialect} ${outcome.version} · ${outcome.table_count} tables · ${outcome.strategy.emptyMode} restore · ${outcome.read_only_enforcement} read-only`;
}

/** The probe's warnings, one line each; a shared database is the one that costs a tester's work. */
export function outcomeWarnings(outcome: ProbeOutcome): string[] {
  return outcome.warnings.map((warning) => warning.message);
}

function messageOf(cause: unknown, fallback: string): string {
  return humanMessage(cause, fallback);
}

export function createAdaptersPresenter(slug: () => string): AdaptersPresenter {
  const adapters = createRefreshable(() => adaptersModel.list(slug()));
  const table = createTableView<Adapter, AdapterSort>({
    rows: () => adapters.value(),
    sorters: {
      name: { text: (adapter) => adapter.name },
      engine: { text: (adapter) => adapter.engine },
      tier: { text: (adapter) => adapter.tier },
      mode: { text: (adapter) => adapter.mode },
      status: { text: (adapter) => adapter.status },
    },
    fields: (adapter) => [adapter.name, adapter.engine, adapter.tier, adapter.mode, adapter.status],
  });
  const [creating, setCreating] = createSignal(false);
  const [values, setValues] = createSignal<Values>({});
  const [outcome, setOutcome] = createSignal<ProbeOutcome | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause: unknown) {
      setError(messageOf(cause, "request failed"));
    } finally {
      setBusy(false);
    }
  };
  return {
    ...adapters,
    table,
    creating,
    values,
    outcome,
    error,
    busy,
    openCreate: () => {
      // The dialog stays mounted and reopens on the same form; start every open blank rather than
      // showing the last attempt's values (formisch-forms skill: reset a dialog form on open).
      setValues({});
      setOutcome(null);
      setError(null);
      setCreating(true);
    },
    closeCreate: () => setCreating(false),
    invalidateOutcome: () => setOutcome(null),
    setValue: (key, value) => {
      setValues((current) => ({ ...current, [key]: value }));
      setOutcome(null);
    },
    test: (input) => {
      const staticBody = toDraftBody(input.engine, input.name, input.mode, values());
      const staticSlug = slug();
      return run(async () => {
        setOutcome(await adaptersModel.test(staticSlug, staticBody));
      });
    },
    create: (input) => {
      // The schema validates engine/name/mode; it cannot see config/secrets (runtime-keyed), so
      // their required fields are checked here, the way the old form guard checked every field.
      const missing = missingRequiredFields(input.engine, values());
      if (missing.length > 0) {
        setError(`Fill in: ${missing.join(", ")}.`);
        return Promise.resolve();
      }
      const staticBody = toDraftBody(input.engine, input.name, input.mode, values());
      const staticSlug = slug();
      return run(async () => {
        const result = await adaptersModel.create(staticSlug, staticBody);
        setCreating(false);
        adapters.refresh();
        showToast(
          result.init_job === null
            ? `${result.adapter.name} added`
            : `${result.adapter.name} added; init snapshot queued`,
          "success"
        );
      });
    },
  };
}
