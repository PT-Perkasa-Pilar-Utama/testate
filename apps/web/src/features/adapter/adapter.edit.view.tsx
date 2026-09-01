import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, untrack } from "solid-js";
import type { Adapter } from "@testate/shared";
import { adapterEditFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { ENGINE_FORMS } from "../adapters/adapters.fields.ts";
import type { EngineForm, Field as EngineField } from "../adapters/adapters.fields.ts";
import { draftFrom } from "./adapter.edit.ts";
import type { AdapterPresenter } from "./adapter.presenter.ts";

// ponytail: "fast" is offered nowhere because no engine implements it. The column and the API
// still take it (06 §6.3, MySQL and MariaDB only); offer it again when mysql/restore.ts reads
// plan.restoreMode and drops the transaction for it.
const RESTORE_OPTIONS = [{ value: "atomic", label: "atomic (one transaction)" }] as const;

function Fields(props: {
  presenter: AdapterPresenter;
  fields: EngineField[];
  prefix: string;
  hint?: string;
}): JSX.Element {
  return (
    <For each={props.fields}>
      {(field) => (
        <label class="grid content-start gap-1.5 text-base">
          <span>
            {field.label}
            {props.hint === undefined ? "" : ` ${props.hint}`}
          </span>
          <Input
            type={field.type === "boolean" ? "text" : field.type}
            autocomplete={field.type === "password" ? "new-password" : "off"}
            placeholder={field.placeholder ?? ""}
            value={props.presenter.values()[`${props.prefix}.${field.key}`] ?? ""}
            onInput={(event) =>
              props.presenter.setValue(`${props.prefix}.${field.key}`, event.currentTarget.value)
            }
          />
        </label>
      )}
    </For>
  );
}

/** Rename, exclusions, schemas, restore knobs, connection, and credentials (stories 23–26, 28, 29). */
export default function EditDialog(props: {
  presenter: AdapterPresenter;
  adapter: Adapter;
}): JSX.Element {
  const engineForm = (): EngineForm => ENGINE_FORMS[props.adapter.engine];
  const form = createForm({
    schema: adapterEditFormSchema,
    initialInput: untrack(() => draftFrom(props.adapter)),
  });

  // The dialog stays mounted (design-system rule); prefill from the record being edited each time
  // it opens rather than showing whatever the previous open left behind.
  createEffect(
    () => (props.presenter.editing() ? draftFrom(props.adapter) : null),
    (draft) => {
      if (draft !== null) onceSettled(() => reset(form, { initialInput: draft }));
    }
  );

  return (
    <Dialog
      open={props.presenter.editing()}
      onClose={() => props.presenter.closeEdit()}
      title={`Edit ${props.adapter.name}`}
      description="Renaming keeps states, mappings, and saved queries. A new host or database takes a new init state."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>Name</span>
              <Input
                {...field.props}
                required
                maxlength="80"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Show when={props.adapter.kind === "database"}>
          <Field of={form} path={["excluded_tables"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>
                  Excluded tables (comma separated; migration tables are excluded by default)
                </span>
                <InputArea
                  {...field.props}
                  rows="2"
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          <Show when={props.adapter.engine === "postgres"}>
            <Field of={form} path={["schemas"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <span>Schemas (comma separated; empty = every non-system schema)</span>
                  <Input
                    {...field.props}
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
          </Show>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field of={form} path={["restore_mode"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <span>Restore mode</span>
                  <Select
                    options={RESTORE_OPTIONS}
                    value={field.input ?? "atomic"}
                    onChange={(value) => field.onInput(value)}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Field of={form} path={["lock_timeout_ms"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <span>Lock timeout (ms)</span>
                  <Input
                    {...field.props}
                    type="number"
                    min="1000"
                    max="600000"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
          </div>
        </Show>
        <div class="grid gap-3 sm:grid-cols-2">
          <Fields presenter={props.presenter} fields={engineForm().config} prefix="config" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Fields
            presenter={props.presenter}
            fields={engineForm().secrets}
            prefix="secret"
            hint="(blank keeps the sealed one)"
          />
        </div>
        <Show when={props.adapter.kind === "database"}>
          <div class="grid gap-3 sm:grid-cols-2">
            <Fields
              presenter={props.presenter}
              fields={engineForm().secrets}
              prefix="readonly"
              hint="for read-only sessions (optional)"
            />
          </div>
        </Show>
        <Banner variant="secondary">
          Secrets are sealed before storage and never shown again.
        </Banner>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save adapter
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
