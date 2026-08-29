import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { TableSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { FIELD_MODES, FUNCTION_OPTIONS } from "./editing.presenter.ts";
import type { EditingPresenter, FieldDraft } from "./editing.presenter.ts";

const MODE_OPTIONS = FIELD_MODES.map((mode) => ({ value: mode, label: mode }));
const EMPTY: FieldDraft = { mode: "value", text: "", fn: "now", input: "" };

function Field(props: {
  presenter: EditingPresenter;
  column: TableSchema["columns"][number];
  field: FieldDraft;
}): JSX.Element {
  const policed = (): boolean => props.column.policy.required_function !== null;
  return (
    <div class="grid gap-1.5 text-sm sm:grid-cols-[10rem_8rem_minmax(0,1fr)] sm:items-center">
      <span>
        <code>{props.column.name}</code>
        <span class="ml-1 text-xs text-kumo-subtle">{props.column.type}</span>
        <Show when={policed()}>
          <span class="ml-1 text-xs text-kumo-subtle">
            · requires {props.column.policy.required_function?.name}
          </span>
        </Show>
      </span>
      <Select
        size="sm"
        aria-label={`${props.column.name} mode`}
        options={MODE_OPTIONS}
        value={props.field.mode}
        onChange={(mode) => props.presenter.setField(props.column.name, { mode })}
      />
      <Show when={props.field.mode === "value"}>
        <Input
          size="sm"
          value={props.field.text}
          onInput={(event) =>
            props.presenter.setField(props.column.name, { text: event.currentTarget.value })
          }
        />
      </Show>
      <Show when={props.field.mode === "function"}>
        <div class="flex gap-2">
          <Select
            size="sm"
            aria-label={`${props.column.name} function`}
            options={FUNCTION_OPTIONS}
            value={props.field.fn}
            onChange={(fn) => props.presenter.setField(props.column.name, { fn })}
          />
          <Input
            size="sm"
            placeholder="input (for hashes)"
            type="password"
            value={props.field.input}
            onInput={(event) =>
              props.presenter.setField(props.column.name, { input: event.currentTarget.value })
            }
          />
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
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.submitForm();
  };
  return (
    <Show when={props.presenter.form()}>
      {(form) => (
        <Dialog
          open
          size="xl"
          onClose={() => props.presenter.closeForm()}
          title={
            form().kind === "insert"
              ? `Insert into ${props.table.name}`
              : `Edit row in ${props.table.name}`
          }
          description="Functions run on the server; a policed column takes its function, never plain text."
        >
          <form class="grid gap-3" onSubmit={onSubmit}>
            <For each={props.table.columns.filter((column) => !column.generated)}>
              {(column) => (
                <Field
                  presenter={props.presenter}
                  column={column}
                  field={form().draft.get(column.name) ?? EMPTY}
                />
              )}
            </For>
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeForm()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {form().kind === "insert" ? "Insert" : "Save"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </Show>
  );
}
