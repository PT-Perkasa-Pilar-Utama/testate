import { createSignal } from "solid-js";
import type { Fixture, JsonObject, JsonValue, TableSchema, WriteSession } from "@testate/shared";
import { fieldModeSchema, functionNameSchema, jsonValueSchema } from "@testate/shared";
import type { RowCell } from "@testate/shared";
import type { formValueSchema } from "@testate/shared";
import * as v from "valibot";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { editingModel } from "./editing.model.ts";
import { policiesModel } from "./policies.model.ts";
import type { LookupRow } from "./policies.model.ts";
import type { FixtureOptions } from "./editing.model.ts";

export type FunctionName = v.InferOutput<typeof functionNameSchema>;
export const FUNCTION_OPTIONS = functionNameSchema.options.map((name) => ({
  value: name,
  label: name,
}));

export const FIELD_MODES = fieldModeSchema.options;
export type FieldMode = v.InferOutput<typeof fieldModeSchema>;
/** One column's cell in the row form; `RowCell` is the same shape, stated in the contract. */
export type FieldDraft = RowCell;

export type FormValue = v.InferOutput<typeof formValueSchema>;

/**
 * Which row is open, and nothing about its values: those live in the Formisch form, seeded through
 * `initialCells` when the dialog opens.
 */
export type FormState =
  | { kind: "insert" }
  | { kind: "update"; pk: JsonObject; original: JsonObject };

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
  /** The cells a freshly opened dialog starts with, for the form to reset itself to. */
  initialCells: () => RowCell[];
  /** `copies` inserts the same cells up to 50 times (story 143); `more` keeps the form open. */
  submitForm: (cells: RowCell[], options?: { copies?: number; more?: boolean }) => Promise<void>;
  remove: (row: JsonObject) => Promise<void>;
  fixture: () => Fixture | null;
  fixtureFor: (row: JsonObject, options: FixtureOptions) => Promise<void>;
  closeFixture: () => void;
  error: () => string | null;
  /** FK candidates for a form field (story 142); the view feeds them to a datalist. */
  candidates: () => LookupRow[];
  lookup: (column: string, q: string) => Promise<void>;
};

const EMPTY_FIELD: Omit<FieldDraft, "column"> = { mode: "value", text: "", fn: "now", input: "" };
/** One row-edits call takes at most 50 edits (06 §6.6). */
export const MAX_COPIES = 50;

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
  const base = { ...EMPTY_FIELD, column: column.name };
  const required = column.policy.required_function;
  if (required !== null)
    return { ...base, mode: row === null ? "function" : "default", fn: required.name };
  if (row === null)
    return { ...base, mode: column.has_default || column.identity ? "default" : "value" };
  const current = row[column.name];
  if (current === null || current === undefined) return { ...base, mode: "null" };
  return { ...base, text: v.is(v.string(), current) ? current : JSON.stringify(current) };
}

/** In table order, generated columns left out: the database decides those. */
export function cellsOf(table: TableSchema, row: JsonObject | null): RowCell[] {
  return table.columns.filter((column) => !column.generated).map((column) => fieldFor(column, row));
}

/**
 * The edits a submitted form sends, or null when it has nothing to say. An update whose row nobody
 * changed sets no columns, and `UPDATE t SET  WHERE ...` is a syntax error in Postgres and MySQL
 * alike, so that edit must never leave the browser.
 */
export function editsFor(
  state: FormState,
  values: JsonObject,
  copies: number
): JsonObject[] | null {
  if (state.kind === "insert") {
    return Array.from({ length: copies }, () => ({ kind: "insert", values }));
  }
  if (Object.keys(values).length === 0) return null;
  return [{ kind: "update", pk: state.pk, values }];
}

/** Update edits carry only the fields that changed from the row; inserts carry every non-default field. */
export function valuesOf(
  cells: readonly RowCell[],
  table: TableSchema,
  original: JsonObject | null
): JsonObject {
  const byColumn = new Map(cells.map((cell) => [cell.column, cell]));
  const values: JsonObject = {};
  for (const column of table.columns) {
    const field = byColumn.get(column.name);
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
  /** Counts lookups so a late answer to an old query cannot overwrite the newest one. */
  let lookups = 0;
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
        showToast("Write session open. This session does not police raw SQL.", "info");
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
      if (table() === null) return;
      setError(null);
      setForm({ kind: "insert" });
    },
    openUpdate: (row) => {
      const schema = table();
      if (schema === null) return;
      setError(null);
      setForm({ kind: "update", pk: pkOf(row, schema), original: row });
    },
    closeForm: () => setForm(null),
    initialCells: () => {
      const schema = table();
      const state = form();
      if (schema === null) return [];
      return cellsOf(schema, state !== null && state.kind === "update" ? state.original : null);
    },
    submitForm: (cells, options = {}) => {
      const staticSlug = slug();
      const staticId = id();
      const staticTable = tableName();
      const schema = table();
      const staticOpen = session();
      const state = form();
      if (schema === null || staticOpen === null || state === null) return Promise.resolve();
      const values = valuesOf(cells, schema, state.kind === "update" ? state.original : null);
      const copies = Math.min(Math.max(options.copies ?? 1, 1), MAX_COPIES);
      const edits = editsFor(state, values, copies);
      // Nothing to send: Save on a row nobody changed means close the form, not fail on it.
      if (edits === null) {
        setForm(null);
        return Promise.resolve();
      }
      const keepOpen = options.more === true && state.kind === "insert";
      setError(null);
      return attempt(async () => {
        try {
          await edit(staticSlug, staticId, staticTable, staticOpen.id, edits);
          if (keepOpen) setForm({ kind: "insert" });
          else setForm(null);
        } catch (cause: unknown) {
          setError(humanMessage(cause, "Could not save that row."));
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
      // Typing fires a lookup per keystroke and the answers can arrive out of order, so an older
      // one used to land last and empty the list under the newest query.
      lookups += 1;
      const mine = lookups;
      return attempt(async () => {
        const found = await policiesModel.lookup(staticSlug, staticId, staticTable, column, q);
        if (mine === lookups) setCandidates(found);
      });
    },
  };
}
