import { createMemo, createSignal } from "solid-js";
import type { Adapter, HostSuggestion, AdapterCreateFormInput } from "@testate/shared";

import { EMPTY_MODE_LABEL, engineLabel } from "@/lib/labels.ts";
import { humanMessage } from "@/lib/api-error.ts";
import { showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import {
  ADAPTER_MODE_LABEL,
  ADAPTER_STATUS_LABEL,
  ENGINE_LABEL,
  TIER_LABEL,
} from "@/lib/labels.ts";
import { activeFilterCount, createTableView } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Refreshable } from "@/lib/async.ts";
import {
  ADAPTER_FILTERS_EMPTY,
  matchesAdapterFilters,
  missingRequiredFields,
  toDraftBody,
} from "./adapters.fields.ts";
import type { AdapterFilters, Values } from "./adapters.fields.ts";
import { adaptersModel } from "./adapters.model.ts";
import type { ProbeOutcome } from "./adapters.model.ts";

/**
 * `engine`, `name` and `mode` live in the Formisch form now (`adapterCreateFormSchema`); this only
 * holds what the form cannot: the per-engine config/secret values (their keys are decided at
 * runtime by `ENGINE_FORMS`, so no static schema can own them) and what the server answers.
 */
export type AdapterSort = "name" | "engine" | "tier" | "mode" | "status";

export type AdaptersPresenter = Refreshable<Adapter[]> & {
  /** Addresses the API can reach, offered under the Host field. */
  hosts: Refreshable<HostSuggestion[]>;
  table: TableView<Adapter, AdapterSort>;
  filters: () => AdapterFilters;
  setFilters: (patch: Partial<AdapterFilters>) => void;
  activeFilters: () => number;
  filtersOpen: () => boolean;
  toggleFilters: () => void;
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
const ENFORCEMENT = {
  transaction: "A read-only transaction",
  credential: "The read-only credential",
  filter: "An application filter",
} as const;

/** The probe's outcome as a sentence a person can act on, not a row of enum values. */
export function describeOutcome(outcome: ProbeOutcome): string {
  if ("reachable" in outcome) return `${engineLabel(outcome.engine)} answers.`;
  const engine = `${engineLabel(outcome.dialect)} ${outcome.version}`;
  const tables = outcome.table_count === 1 ? "1 table" : `${outcome.table_count} tables`;
  const restore = EMPTY_MODE_LABEL[outcome.strategy.emptyMode];
  const enforcement = ENFORCEMENT[outcome.read_only_enforcement];
  return `${engine} answers: ${tables}. Restores empty a table by ${restore}. ${enforcement} keeps sessions read-only.`;
}

/** The probe's warnings, one line each; a shared database is the one that costs a tester's work. */
export function outcomeWarnings(outcome: ProbeOutcome): string[] {
  return outcome.warnings.map((warning) => warning.message);
}

function messageOf(cause: unknown, fallback: string): string {
  return humanMessage(cause, fallback);
}

export function createAdaptersPresenter(
  slug: () => string,
  onChanged: () => void = () => undefined
): AdaptersPresenter {
  const adapters = createRefreshable(() => adaptersModel.list(slug()));
  // Asked for once with the adapter list, not when the dialog opens: `createRefreshable` is a memo
  // and a memo computes when it is created. One small request, and the buttons are ready by the
  // time anyone reaches the Host field.
  const hosts = createRefreshable(() => adaptersModel.hosts());
  const table = createTableView<Adapter, AdapterSort>({
    rows: () => adapters.value(),
    sorters: {
      name: { text: (adapter) => adapter.name },
      engine: { text: (adapter) => adapter.engine },
      tier: { text: (adapter) => adapter.tier },
      mode: { text: (adapter) => adapter.mode },
      status: { text: (adapter) => adapter.status },
    },
    // Both the stored value and the word on screen: the table says "PostgreSQL" and the row holds
    // "postgres", and a search that knew only one of them fails whichever the person types.
    fields: (adapter) => [
      adapter.name,
      adapter.engine,
      ENGINE_LABEL[adapter.engine],
      adapter.tier,
      TIER_LABEL[adapter.tier],
      adapter.mode,
      ADAPTER_MODE_LABEL[adapter.mode],
      adapter.status,
      ADAPTER_STATUS_LABEL[adapter.status],
    ],
  });
  const [filters, setFiltersSignal] = createSignal<AdapterFilters>(ADAPTER_FILTERS_EMPTY);
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const filteredRows = createMemo((): Adapter[] =>
    table.rows().filter((adapter) => matchesAdapterFilters(adapter, filters()))
  );
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
    hosts,
    table: { ...table, rows: filteredRows },
    filters,
    setFilters: (patch) => setFiltersSignal((current) => ({ ...current, ...patch })),
    activeFilters: () => {
      const current = filters();
      return activeFilterCount(
        current.engine !== "",
        current.tier !== "",
        current.mode !== "",
        current.status !== ""
      );
    },
    filtersOpen,
    toggleFilters: () => setFiltersOpen((open) => !open),
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
        onChanged();
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
