import { Field, FieldArray, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, createSignal, untrack } from "solid-js";
import type { TableSchema } from "@testate/shared";
import { rowFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { FIELD_MODE_OPTIONS } from "@/lib/labels.ts";
import { FUNCTION_OPTIONS, MAX_COPIES, cellsOf } from "./editing.presenter.ts";
import type { EditingPresenter } from "./editing.presenter.ts";

type RowForm = ReturnType<typeof createForm<typeof rowFormSchema>>;

/**
 * One column's cell.
 *
 * The columns are the live table's, so they are a list rather than named properties, and each
 * cell's four parts hang off its index. The mode is read with `getInput` instead of another
 * `<Field>`, because the branches below it would then be nested inside that field's own callback,
 * which is the stale-narrowed-value trap.
 */
function Cell(props: {
  presenter: EditingPresenter;
  form: RowForm;
  index: number;
  column: TableSchema["columns"][number];
  foreignKey: boolean;
}): JSX.Element {
  const policed = (): boolean => props.column.policy.required_function !== null;
  const listId = (): string => `lookup-${props.column.name}`;
  const mode = (): string =>
    getInput(props.form, { path: ["cells", props.index, "mode"] }) ?? "value";
  return (
    <div class="grid gap-1.5 text-sm sm:grid-cols-[10rem_8rem_minmax(0,1fr)] sm:items-center">
      <span>
        <code>{props.column.name}</code>
        <span class="ml-1 text-xs text-muted">{props.column.type}</span>
        <Show when={policed()}>
          <span class="ml-1 text-xs text-muted">
            · requires {props.column.policy.required_function?.name}
          </span>
        </Show>
      </span>
      <Field of={props.form} path={["cells", props.index, "mode"]}>
        {(field) => (
          <Select
            size="sm"
            aria-label={`${props.column.name} mode`}
            options={FIELD_MODE_OPTIONS}
            value={field.input ?? "value"}
            onChange={(next) => field.onInput(next)}
          />
        )}
      </Field>
      <Show when={mode() === "value"}>
        <Field of={props.form} path={["cells", props.index, "text"]}>
          {(field) => (
            <Input
              size="sm"
              list={props.foreignKey ? listId() : undefined}
              value={field.input ?? ""}
              onInput={(event) => {
                field.onInput(event.currentTarget.value);
                if (props.foreignKey) {
                  void props.presenter.lookup(props.column.name, event.currentTarget.value);
                }
              }}
            />
          )}
        </Field>
        <Show when={props.foreignKey}>
          <datalist id={listId()}>
            <For each={props.presenter.candidates()}>
              {(candidate) => (
                <option value={String(candidate.key[0] ?? "")}>{candidate.display}</option>
              )}
            </For>
          </datalist>
        </Show>
      </Show>
      <Show when={mode() === "function"}>
        <div class="flex gap-2">
          <Field of={props.form} path={["cells", props.index, "fn"]}>
            {(field) => (
              <Select
                size="sm"
                aria-label={`${props.column.name} function`}
                options={FUNCTION_OPTIONS}
                value={field.input ?? "now"}
                onChange={(next) => field.onInput(next)}
              />
            )}
          </Field>
          <Field of={props.form} path={["cells", props.index, "input"]}>
            {(field) => (
              <Input
                size="sm"
                placeholder="input (for hashes)"
                type="password"
                value={field.input ?? ""}
                onInput={(event) => field.onInput(event.currentTarget.value)}
              />
            )}
          </Field>
        </div>
      </Show>
    </div>
  );
}

/** Insert and edit share one typed form (24 §24.2): value, NULL, default, or a server-side function. */
export default function RowForm(props: {
  presenter: EditingPresenter;
  table: TableSchema;
}): JSX.Element {
  const [copies, setCopies] = createSignal("1");
  const [more, setMore] = createSignal(false);
  // Seeded at creation, not only on open: a field store per array item is built from the initial
  // input, and an array that starts empty stays empty however often it is reset afterwards. The
  // table's columns are known here, and their number never changes while this form is mounted.
  const form = createForm({
    schema: rowFormSchema,
    // Read once, deliberately: `grid.view.tsx` keys this component on the table, so a different
    // table gets a different form rather than this one growing new cells.
    initialInput: untrack(() => ({ cells: cellsOf(props.table, null) })),
  });
  const columns = (): TableSchema["columns"] =>
    props.table.columns.filter((column) => !column.generated);
  const foreignKey = (name: string): boolean =>
    props.table.foreign_keys_out.some((fk) => fk.columns.includes(name));
  // The dialog's own state decides the values, so the form is seeded when it opens rather than
  // when it mounts: an insert starts on the table's defaults, an edit on the row being edited.
  // Everything reactive is read in the compute; the effect only writes. Reading the presenter
  // inside the effect callback is a read outside any tracking scope, which Solid 2 refuses.
  createEffect(
    () => (props.presenter.form() === null ? null : props.presenter.initialCells()),
    (cells) => {
      if (cells !== null) onceSettled(() => reset(form, { initialInput: { cells } }));
    }
  );
  return (
    <Show when={props.presenter.form()}>
      {(open) => (
        <FormDialog
          open
          size="xl"
          onClose={props.presenter.closeForm}
          title={
            open().kind === "insert"
              ? `Insert into ${props.table.name}`
              : `Edit row in ${props.table.name}`
          }
          description="Functions run on the server; a policed column takes its function, never plain text."
        >
          <Form
            of={form}
            class="grid gap-3"
            onSubmit={(input) =>
              props.presenter.submitForm(input.cells, {
                copies: Number.parseInt(copies(), 10),
                more: more(),
              })
            }
          >
            {/* The cells are seeded from these columns in this order, so the column carries the
                metadata and the array only says how many there are. */}
            <FieldArray of={form} path={["cells"]}>
              {(cells) => (
                <For each={columns().slice(0, cells.items.length)}>
                  {(column, index) => (
                    <Cell
                      presenter={props.presenter}
                      form={form}
                      index={index()}
                      column={column}
                      foreignKey={foreignKey(column.name)}
                    />
                  )}
                </For>
              )}
            </FieldArray>
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <DialogActions>
              <Show when={open().kind === "insert"}>
                <label class="flex items-center gap-2 text-base">
                  <FieldLabel required={false}>Copies</FieldLabel>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max={String(MAX_COPIES)}
                    value={copies()}
                    onInput={(event) => setCopies(event.currentTarget.value)}
                  />
                </label>
                {/* Both buttons submit, so both go through the schema and hand the handler the
                    same parsed cells; only the "keep it open afterwards" flag differs. */}
                <Button type="submit" variant="secondary" onClick={() => setMore(true)}>
                  Insert and add another
                </Button>
              </Show>
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeForm()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" onClick={() => setMore(false)}>
                {open().kind === "insert" ? "Insert" : "Save"}
              </Button>
            </DialogActions>
          </Form>
        </FormDialog>
      )}
    </Show>
  );
}
