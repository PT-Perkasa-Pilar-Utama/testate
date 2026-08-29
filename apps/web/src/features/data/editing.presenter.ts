import { createSignal } from "solid-js";
import type { Fixture, JsonObject, JsonValue, TableSchema, WriteSession } from "@testate/shared";
import { functionNameSchema, jsonValueSchema } from "@testate/shared";
import type { formValueSchema } from "@testate/shared";
import * as v from "valibot";

import { attempt, showToast } from "@/components/toast.tsx";
import { editingModel } from "./editing.model.ts";
import { policiesModel } from "./policies.model.ts";
import type { LookupRow } from "./policies.model.ts";
import type { FixtureOptions } from "./editing.model.ts";

export type FunctionName = v.InferOutput<typeof functionNameSchema>;
export const FUNCTION_OPTIONS = functionNameSchema.options.map((name) => ({
  value: name,
  label: name,
}));

export const FIELD_MODES = ["value", "null", "default", "function"] as const;
export type FieldMode = (typeof FIELD_MODES)[number];
export type FieldDraft = { mode: FieldMode; text: string; fn: FunctionName; input: string };
export type RowDraft = Map<string, FieldDraft>;

export type FormValue = v.InferOutput<typeof formValueSchema>;

export type FormState =
  | { kind: "insert"; draft: RowDraft }
  | { kind: "update"; pk: JsonObject; original: JsonObject; draft: RowDraft };

export type EditingPresenter = {
  session: () => WriteSession | null;
  canWrite: () => boolean;
  start: () => Promise<void>;
  end: () => Promise<void>;
  setForeignKeyChecks: (on: boolean) => Promise<void>;
  form: () => FormState | null;
  openInsert: () => void;
  openUpdate: (row: JsonObject) => void;
  closeForm: () => void;
  setField: (column: string, patch: Partial<FieldDraft>) => void;
  submitForm: () => Promise<void>;
  remove: (row: JsonObject) => Promise<void>;
  fixture: () => Fixture | null;
  fixtureFor: (row: JsonObject, options: FixtureOptions) => Promise<void>;
  closeFixture: () => void;
  error: () => string | null;
  /** FK candidates for a form field (story 142); the view feeds them to a datalist. */
  candidates: () => LookupRow[];
  lookup: (column: string, q: string) => Promise<void>;
};

const EMPTY_FIELD: FieldDraft = { mode: "value", text: "", fn: "now", input: "" };

/** Text from the form to the typed FormValue (24 §24.2): numbers and JSON stay typed, the rest is text. */
export function toFormValue(field: FieldDraft, columnType: string): FormValue {
  if (field.mode === "null") return { kind: "null" };
  if (field.mode === "default") return { kind: "default" };
  if (field.mode === "function") {
    const value: FormValue = { kind: "function", name: field.fn };
    if (field.input !== "") value.input = field.input;
    return value;
  }
  return { kind: "value", value: typedValue(field.text, columnType) };
}

function typedValue(text: string, columnType: string): JsonValue {
  const type = columnType.toLowerCase();
  if (
    /^(int|bigint|smallint|integer|serial|numeric|decimal|real|double|float|tinyint)/.test(type)
  ) {
    const number = Number(text);
    return Number.isFinite(number) && text.trim() !== "" && !/^(bigint|numeric|decimal)/.test(type)
      ? number
      : text;
  }
  if (/^(bool|boolean|tinyint\(1\))/.test(type)) return text === "true" || text === "1";
  if (/^(json|jsonb)/.test(type)) {
    try {
      return v.parse(v.any(), JSON.parse(text));
    } catch {
      return text;
    }
  }
  return text;
}

/** The primary-key columns of a row as the `pk` object edits and fixtures take. */
export function pkOf(row: JsonObject, table: TableSchema): JsonObject {
  const pk: JsonObject = {};
  for (const column of table.primary_key ?? []) pk[column] = row[column] ?? null;
  return pk;
}

function fieldFor(column: TableSchema["columns"][number], row: JsonObject | null): FieldDraft {
  const required = column.policy.required_function;
  if (required !== null)
    return { ...EMPTY_FIELD, mode: row === null ? "function" : "default", fn: required.name };
  if (row === null) return { ...EMPTY_FIELD, mode: column.has_default ? "default" : "value" };
  const current = row[column.name];
  if (current === null || current === undefined) return { ...EMPTY_FIELD, mode: "null" };
  return { ...EMPTY_FIELD, text: v.is(v.string(), current) ? current : JSON.stringify(current) };
}

function draftOf(table: TableSchema, row: JsonObject | null): RowDraft {
  const draft: RowDraft = new Map();
  for (const column of table.columns) {
    if (!column.generated) draft.set(column.name, fieldFor(column, row));
  }
  return draft;
}

/** Update edits carry only the fields that changed from the row; inserts carry every non-default field. */
export function valuesOf(
  draft: RowDraft,
  table: TableSchema,
  original: JsonObject | null
): JsonObject {
  const values: JsonObject = {};
  for (const column of table.columns) {
    const field = draft.get(column.name);
    if (field === undefined) continue;
    if (original !== null && field.mode === "default") continue;
    if (original !== null && field.mode === "value") {
      const before = original[column.name];
      const beforeText = v.is(v.string(), before) ? before : JSON.stringify(before);
      if (beforeText === field.text) continue;
    }
    values[column.name] = v.parse(jsonValueSchema, toFormValue(field, column.type));
  }
  return values;
}

export function createEditingPresenter(
  slug: () => string,
  id: () => string,
  tableName: () => string,
  table: () => TableSchema | null,
  onWrite: () => void
): EditingPresenter {
  const [session, setSession] = createSignal<WriteSession | null>(null);
  const [form, setForm] = createSignal<FormState | null>(null);
  const [fixture, setFixture] = createSignal<Fixture | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [candidates, setCandidates] = createSignal<LookupRow[]>([]);
  const edit = async (
    staticSlug: string,
    staticId: string,
    staticTable: string,
    staticSession: string,
    edits: JsonObject[]
  ): Promise<void> => {
    const result = await editingModel.rowEdits(
      staticSlug,
      staticId,
      staticTable,
      staticSession,
      edits
    );
    if (result.stash_state_id !== null)
      showToast("A stash was taken before the first write", "info");
    onWrite();
  };
  return {
    session,
    canWrite: () => session() !== null,
    start: () => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        const opened = await editingModel.startSession(staticSlug, staticId, true);
        setSession(opened);
        showToast("Write session open; raw SQL in this session is not policed", "info");
      });
    },
    end: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticOpen = session();
      if (staticOpen === null) return Promise.resolve();
      return attempt(async () => {
        await editingModel.endSession(staticSlug, staticId, staticOpen.id);
        setSession(null);
        setForm(null);
      });
    },
    setForeignKeyChecks: (on) => {
      const staticSlug = slug();
      const staticId = id();
      const staticOpen = session();
      if (staticOpen === null) return Promise.resolve();
      return attempt(async () => {
        setSession(await editingModel.setForeignKeyChecks(staticSlug, staticId, staticOpen.id, on));
      });
    },
    form,
    openInsert: () => {
      const schema = table();
      if (schema === null) return;
      setError(null);
      setForm({ kind: "insert", draft: draftOf(schema, null) });
    },
    openUpdate: (row) => {
      const schema = table();
      if (schema === null) return;
      setError(null);
      setForm({
        kind: "update",
        pk: pkOf(row, schema),
        original: row,
        draft: draftOf(schema, row),
      });
    },
    closeForm: () => setForm(null),
    setField: (column, patch) =>
      setForm((current) => {
        if (current === null) return null;
        const field = current.draft.get(column) ?? EMPTY_FIELD;
        const draft = new Map(current.draft);
        draft.set(column, { ...field, ...patch });
        return { ...current, draft };
      }),
    submitForm: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticTable = tableName();
      const schema = table();
      const staticOpen = session();
      const state = form();
      if (schema === null || staticOpen === null || state === null) return Promise.resolve();
      const values = valuesOf(state.draft, schema, state.kind === "update" ? state.original : null);
      const edits: JsonObject[] =
        state.kind === "insert"
          ? [{ kind: "insert", values }]
          : [{ kind: "update", pk: state.pk, values }];
      setError(null);
      return attempt(async () => {
        try {
          await edit(staticSlug, staticId, staticTable, staticOpen.id, edits);
          setForm(null);
        } catch (cause: unknown) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    },
    remove: (row) => {
      const staticSlug = slug();
      const staticId = id();
      const staticTable = tableName();
      const schema = table();
      const staticOpen = session();
      if (schema === null || staticOpen === null) return Promise.resolve();
      const pk = pkOf(row, schema);
      return attempt(() =>
        edit(staticSlug, staticId, staticTable, staticOpen.id, [{ kind: "delete", pk }])
      );
    },
    fixture,
    fixtureFor: (row, options) => {
      const staticSlug = slug();
      const staticId = id();
      const staticTable = tableName();
      const schema = table();
      if (schema === null) return Promise.resolve();
      const pk = pkOf(row, schema);
      return attempt(async () => {
        setFixture(await editingModel.fixture(staticSlug, staticId, staticTable, pk, options));
      });
    },
    closeFixture: () => setFixture(null),
    error,
    candidates,
    lookup: (column, q) => {
      const staticSlug = slug();
      const staticId = id();
      const staticTable = tableName();
      return attempt(async () => {
        setCandidates(await policiesModel.lookup(staticSlug, staticId, staticTable, column, q));
      });
    },
  };
}
