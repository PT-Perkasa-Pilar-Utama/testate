import { createSignal } from "solid-js";
import type { Adapter, Engine, HostSuggestion, JsonObject } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { showToast } from "@/lib/toast.ts";
import { missingRequiredFields } from "../adapters/adapters.fields.ts";
import type { Connection, EngineForm, Values } from "../adapters/adapters.fields.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import type { ProbeOutcome } from "../adapters/adapters.model.ts";

/** A dialog's seed: the form's fields, and the login as the field inputs' values. */
export type ConnectionDraft<TInput> = { input: TInput; values: Values };

/**
 * What tells one connection dialog from another (#69 logfile, #86 journald): its blank draft, an
 * edited adapter's draft, its create and edit bodies, and the fields a create needs.
 */
export type ConnectionKind<TInput, TForm> = {
  blank: TInput;
  draftFrom: (adapter: Adapter) => ConnectionDraft<TInput>;
  toBody: (input: TForm, values: Values) => JsonObject;
  toPatch: (input: TForm, values: Values) => JsonObject;
  formOf: (input: TForm) => Engine | EngineForm;
};

/** A log adapter's create body: always read-only (Q3 of docs/decisions/2026-10-10-logs-tier.md). */
export function logAdapterBody(engine: Engine, name: string, connection: Connection): JsonObject {
  return { kind: "logs", engine, name: name.trim(), mode: "read_only", ...connection };
}

/** Its edit body: a blank secret keeps the stored one, so only typed secrets are sent. */
export function logAdapterPatch(name: string, connection: Connection): JsonObject {
  const body: JsonObject = { name: name.trim(), config: connection.config };
  if (Object.keys(connection.secrets).length > 0) body.secrets = connection.secrets;
  return body;
}

export type ConnectionFormPresenter<TInput, TForm> = {
  hosts: Refreshable<HostSuggestion[]>;
  open: () => boolean;
  /** The adapter being edited, or null while one is being created. */
  editing: () => Adapter | null;
  /** The form's seed for the open: a blank draft, or the edited adapter's. */
  seed: () => TInput;
  values: () => Values;
  setValue: (key: string, value: string) => void;
  outcome: () => ProbeOutcome | null;
  invalidateOutcome: () => void;
  error: () => string | null;
  busy: () => boolean;
  openCreate: () => void;
  openEdit: (adapter: Adapter) => void;
  close: () => void;
  test: (input: TForm) => Promise<void>;
  save: (input: TForm) => Promise<void>;
};

export function createConnectionFormPresenter<TInput, TForm>(
  kind: ConnectionKind<TInput, TForm>,
  slug: () => string,
  onSaved: () => void
): ConnectionFormPresenter<TInput, TForm> {
  const hosts = createRefreshable(() => adaptersModel.hosts());
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Adapter | null>(null);
  // Boxed: a bare generic could be a function, which Solid's setter would call as an updater.
  const [seed, setSeed] = createSignal<{ input: TInput }>({ input: kind.blank });
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
      setError(humanMessage(cause, "The log adapter could not be saved"));
    } finally {
      setBusy(false);
    }
  };
  const start = (adapter: Adapter | null, draft: ConnectionDraft<TInput>): void => {
    setEditing(adapter);
    setSeed({ input: draft.input });
    setValues(draft.values);
    setOutcome(null);
    setError(null);
    setOpen(true);
  };
  const create = (input: TForm): Promise<void> => {
    const missing = missingRequiredFields(kind.formOf(input), values());
    if (missing.length > 0) {
      setError(`Fill in: ${missing.join(", ")}.`);
      return Promise.resolve();
    }
    const staticSlug = slug();
    const body = kind.toBody(input, values());
    return run(async () => {
      const result = await adaptersModel.create(staticSlug, body);
      setOpen(false);
      onSaved();
      showToast(`${result.adapter.name} added`, "success");
    });
  };
  const update = (adapter: Adapter, input: TForm): Promise<void> => {
    const staticSlug = slug();
    const body = kind.toPatch(input, values());
    return run(async () => {
      await adaptersModel.update(staticSlug, adapter.id, body);
      setOpen(false);
      onSaved();
      showToast("Log adapter saved", "success");
    });
  };
  return {
    hosts,
    open,
    editing,
    seed: () => seed().input,
    values,
    setValue: (key, value) => {
      setValues((current) => ({ ...current, [key]: value }));
      setOutcome(null);
    },
    outcome,
    invalidateOutcome: () => setOutcome(null),
    error,
    busy,
    openCreate: () => start(null, { input: kind.blank, values: {} }),
    openEdit: (adapter) => start(adapter, kind.draftFrom(adapter)),
    close: () => setOpen(false),
    test: (input) => {
      const staticSlug = slug();
      const body = kind.toBody(input, values());
      return run(async () => {
        setOutcome(await adaptersModel.test(staticSlug, body));
      });
    },
    save: (input) => {
      const adapter = editing();
      return adapter === null ? create(input) : update(adapter, input);
    },
  };
}
