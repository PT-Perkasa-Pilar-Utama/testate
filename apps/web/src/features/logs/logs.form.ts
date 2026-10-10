import { createSignal } from "solid-js";
import * as v from "valibot";
import type {
  Adapter,
  HostSuggestion,
  JsonObject,
  LogfileConfig,
  LogfileForm,
  LogfileFormInput,
  LogSource,
} from "@testate/shared";
import { logfileConfigSchema, patternLines } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { showToast } from "@/lib/toast.ts";
import { ENGINE_FORMS, connectionOf, missingRequiredFields } from "../adapters/adapters.fields.ts";
import type { Connection, Values } from "../adapters/adapters.fields.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import type { ProbeOutcome } from "../adapters/adapters.model.ts";

/** A source as the dialog first shows it: pm2's out and error files, the common case (#69). */
export const BLANK_SOURCE = {
  name: "",
  glob: "",
  format: "pm2",
  regex: "",
  patterns: "",
} as const satisfies LogfileFormInput["sources"][number];

export const BLANK_LOGFILE: LogfileFormInput = {
  name: "",
  transport: "sftp",
  sources: [{ ...BLANK_SOURCE }],
};

function sourceBody(source: LogfileForm["sources"][number]): JsonObject {
  const body: JsonObject = {
    name: source.name.trim(),
    glob: source.glob.trim(),
    format: source.format,
    patterns: patternLines(source.patterns),
  };
  if (source.format === "regex") body.regex = source.regex;
  return body;
}

/** The connection's fields from `values` as the transport's storage engine, plus the sources. */
function configAndSecrets(input: LogfileForm, values: Values): Connection {
  const { config, secrets } = connectionOf(input.transport, values);
  return {
    config: { ...config, transport: input.transport, sources: input.sources.map(sourceBody) },
    secrets,
  };
}

/** The create body: a logs adapter is always read-only (Q3). */
export function toLogfileBody(input: LogfileForm, values: Values): JsonObject {
  const { config, secrets } = configAndSecrets(input, values);
  return {
    kind: "logs",
    engine: "logfile",
    name: input.name.trim(),
    mode: "read_only",
    config,
    secrets,
  };
}

/** The edit body: a blank secret keeps the stored one, so only typed secrets are sent. */
export function toLogfilePatch(input: LogfileForm, values: Values): JsonObject {
  const { config, secrets } = configAndSecrets(input, values);
  const body: JsonObject = { name: input.name.trim(), config };
  if (Object.keys(secrets).length > 0) body.secrets = secrets;
  return body;
}

function formSource(source: LogSource): LogfileFormInput["sources"][number] {
  return {
    name: source.name,
    glob: source.glob,
    format: source.format,
    regex: source.regex ?? "",
    patterns: source.patterns.join("\n"),
  };
}

const scalarSchema = v.union([v.string(), v.number(), v.boolean()]);

/** A stored connection field as the text box shows it; null when it is not set. */
function asText(config: LogfileConfig, key: string): string | null {
  const parsed = v.safeParse(scalarSchema, new Map(Object.entries(config)).get(key));
  return parsed.success ? String(parsed.output) : null;
}

export type LogfileDraft = { input: LogfileFormInput; values: Values };

/** The dialog\'s seed for an adapter being edited: its fields, and its connection as values. */
export function logfileDraftFrom(adapter: Adapter): LogfileDraft {
  const config = v.parse(logfileConfigSchema, adapter.config);
  const values: Values = {};
  for (const field of ENGINE_FORMS[config.transport].config) {
    const text = asText(config, field.key);
    if (text !== null) values[`config.${field.key}`] = text;
  }
  return {
    input: {
      name: adapter.name,
      transport: config.transport,
      sources: config.sources.map(formSource),
    },
    values,
  };
}

export type LogfileFormPresenter = {
  hosts: Refreshable<HostSuggestion[]>;
  open: () => boolean;
  /** The adapter being edited, or null while one is being created. */
  editing: () => Adapter | null;
  /** The form's seed for the open: a blank draft, or the edited adapter's. */
  seed: () => LogfileFormInput;
  values: () => Values;
  setValue: (key: string, value: string) => void;
  outcome: () => ProbeOutcome | null;
  invalidateOutcome: () => void;
  error: () => string | null;
  busy: () => boolean;
  openCreate: () => void;
  openEdit: (adapter: Adapter) => void;
  close: () => void;
  test: (input: LogfileForm) => Promise<void>;
  save: (input: LogfileForm) => Promise<void>;
};

export function createLogfileFormPresenter(
  slug: () => string,
  onSaved: () => void
): LogfileFormPresenter {
  const hosts = createRefreshable(() => adaptersModel.hosts());
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Adapter | null>(null);
  const [seed, setSeed] = createSignal<LogfileFormInput>(BLANK_LOGFILE);
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
      setError(humanMessage(cause, "The log source could not be saved"));
    } finally {
      setBusy(false);
    }
  };
  const start = (adapter: Adapter | null, draft: LogfileDraft): void => {
    setEditing(adapter);
    setSeed(draft.input);
    setValues(draft.values);
    setOutcome(null);
    setError(null);
    setOpen(true);
  };
  const create = (input: LogfileForm): Promise<void> => {
    const missing = missingRequiredFields(input.transport, values());
    if (missing.length > 0) {
      setError(`Fill in: ${missing.join(", ")}.`);
      return Promise.resolve();
    }
    const staticSlug = slug();
    const body = toLogfileBody(input, values());
    return run(async () => {
      const result = await adaptersModel.create(staticSlug, body);
      setOpen(false);
      onSaved();
      showToast(`${result.adapter.name} added`, "success");
    });
  };
  const update = (adapter: Adapter, input: LogfileForm): Promise<void> => {
    const staticSlug = slug();
    const body = toLogfilePatch(input, values());
    return run(async () => {
      await adaptersModel.update(staticSlug, adapter.id, body);
      setOpen(false);
      onSaved();
      showToast("Log source saved", "success");
    });
  };
  return {
    hosts,
    open,
    editing,
    seed,
    values,
    setValue: (key, value) => {
      setValues((current) => ({ ...current, [key]: value }));
      setOutcome(null);
    },
    outcome,
    invalidateOutcome: () => setOutcome(null),
    error,
    busy,
    openCreate: () => start(null, { input: BLANK_LOGFILE, values: {} }),
    openEdit: (adapter) => start(adapter, logfileDraftFrom(adapter)),
    close: () => setOpen(false),
    test: (input) => {
      const staticSlug = slug();
      const body = toLogfileBody(input, values());
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
