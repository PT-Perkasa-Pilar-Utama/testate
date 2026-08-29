import { createSignal } from "solid-js";
import type { Adapter, Engine } from "@testate/shared";

import { showToast } from "@/components/toast.tsx";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { ENGINE_FORMS, toDraftBody } from "./adapters.fields.ts";
import type { EngineForm, Values } from "./adapters.fields.ts";
import { adaptersModel } from "./adapters.model.ts";
import type { ProbeOutcome } from "./adapters.model.ts";

export type AdaptersPresenter = Refreshable<Adapter[]> & {
  creating: () => boolean;
  engine: () => Engine;
  form: () => EngineForm;
  name: () => string;
  mode: () => "sandbox" | "read_only";
  values: () => Values;
  outcome: () => ProbeOutcome | null;
  error: () => string | null;
  busy: () => boolean;
  openCreate: () => void;
  closeCreate: () => void;
  setEngine: (engine: Engine) => void;
  setName: (name: string) => void;
  setMode: (mode: "sandbox" | "read_only") => void;
  setValue: (key: string, value: string) => void;
  test: () => Promise<void>;
  create: () => Promise<void>;
};

/** A probe outcome as one line for the test banner. */
export function describeOutcome(outcome: ProbeOutcome): string {
  if ("reachable" in outcome) return `${outcome.engine} reachable (${outcome.tier} tier)`;
  return `${outcome.dialect} ${outcome.version} · ${outcome.table_count} tables · ${outcome.strategy.emptyMode} restore · ${outcome.read_only_enforcement} read-only`;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function createAdaptersPresenter(slug: () => string): AdaptersPresenter {
  const adapters = createRefreshable(() => adaptersModel.list(slug()));
  const [creating, setCreating] = createSignal(false);
  const [engine, setEngineSignal] = createSignal<Engine>("postgres");
  const [name, setName] = createSignal("");
  const [mode, setMode] = createSignal<"sandbox" | "read_only">("sandbox");
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
    creating,
    engine,
    form: () => ENGINE_FORMS[engine()],
    name,
    mode,
    values,
    outcome,
    error,
    busy,
    openCreate: () => {
      setOutcome(null);
      setError(null);
      setCreating(true);
    },
    closeCreate: () => setCreating(false),
    setEngine: (next) => {
      setEngineSignal(next);
      setOutcome(null);
    },
    setName,
    setMode,
    setValue: (key, value) => {
      setValues((current) => ({ ...current, [key]: value }));
      setOutcome(null);
    },
    test: () => {
      const staticBody = toDraftBody(engine(), name(), mode(), values());
      const staticSlug = slug();
      return run(async () => {
        setOutcome(await adaptersModel.test(staticSlug, staticBody));
      });
    },
    create: () => {
      const staticBody = toDraftBody(engine(), name(), mode(), values());
      const staticSlug = slug();
      return run(async () => {
        const result = await adaptersModel.create(staticSlug, staticBody);
        setCreating(false);
        setValues({});
        setName("");
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
