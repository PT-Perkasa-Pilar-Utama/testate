import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, untrack } from "solid-js";
import type { Adapter } from "@testate/shared";
import { adapterEditFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { RESTORE_MODE_LABEL } from "@/lib/labels.ts";
import { ENGINE_FORMS } from "../adapters/adapters.fields.ts";
import type { EngineForm, Field as EngineField } from "../adapters/adapters.fields.ts";
import { draftFrom } from "./adapter.edit.ts";
import type { AdapterPresenter } from "./adapter.presenter.ts";

// ponytail: "fast" is offered nowhere because no engine implements it. The column and the API
// still take it (06 §6.3, MySQL and MariaDB only); offer it again when mysql/restore.ts reads
// plan.restoreMode and drops the transaction for it.
const RESTORE_OPTIONS = [{ value: "atomic", label: RESTORE_MODE_LABEL.atomic }] as const;

/** A short line under a field, for what the label is too short to say. */
function Hint(props: { children: JSX.Element }): JSX.Element {
  return <p class="text-xs text-muted">{props.children}</p>;
}

function Fields(props: {
  presenter: AdapterPresenter;
  fields: EngineField[];
  prefix: string;
  /** Rendered before the field's own label: "Read-only" makes "Read-only password". */
  labelPrefix?: string;
  hint?: string;
}): JSX.Element {
  const label = (field: EngineField): string =>
    props.labelPrefix === undefined
      ? field.label
      : `${props.labelPrefix} ${field.label.toLowerCase()}`;
  return (
    <For each={props.fields}>
      {(field) => (
        <label class="grid content-start gap-1.5 text-base">
          <FieldLabel required={field.required === true && props.hint === undefined}>
            {label(field)}
          </FieldLabel>
          <Input
            required={field.required === true}
            type={field.type === "boolean" ? "text" : field.type}
            autocomplete={field.type === "password" ? "new-password" : "off"}
            placeholder={field.placeholder ?? ""}
            value={props.presenter.values()[`${props.prefix}.${field.key}`] ?? ""}
            onInput={(event) =>
              props.presenter.setValue(`${props.prefix}.${field.key}`, event.currentTarget.value)
            }
          />
          <Show when={props.hint}>{(text) => <Hint>{text()}</Hint>}</Show>
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
    <FormDialog
      open={props.presenter.editing()}
      onClose={props.presenter.closeEdit}
      title={`Edit ${props.adapter.name}`}
      description="Renaming keeps states, normalizers, and saved queries. A new host or database takes a new init state."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Name</FieldLabel>
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
                <FieldLabel required={false}>Excluded tables</FieldLabel>
                <InputArea
                  {...field.props}
                  rows="2"
                  placeholder="audit_log, sessions"
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <Hint>Comma separated. Migration tables are excluded by default.</Hint>
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          <Show when={props.adapter.engine === "postgres"}>
            <Field of={form} path={["schemas"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <FieldLabel required={false}>Schemas</FieldLabel>
                  <Input
                    {...field.props}
                    placeholder="public"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <Hint>Comma separated. Empty means every schema that is not the system's.</Hint>
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
          </Show>
          <div class="grid gap-3 sm:grid-cols-2">
            {/* A choice with one option is not a choice: the select appears once a second mode is
                offered (see RESTORE_OPTIONS); until then the form keeps the value it was given. */}
            <Show when={RESTORE_OPTIONS.length > 1}>
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
            </Show>
            <Field of={form} path={["lock_timeout_ms"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <FieldLabel required={false}>Lock timeout</FieldLabel>
                  <Input
                    {...field.props}
                    type="number"
                    min="1000"
                    max="600000"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <Hint>Milliseconds a restore waits for a table lock before it gives up.</Hint>
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
            hint="Blank keeps the one on record."
          />
        </div>
        <Show when={props.adapter.kind === "database"}>
          <div class="grid gap-3 sm:grid-cols-2">
            <Fields
              presenter={props.presenter}
              fields={engineForm().secrets}
              prefix="readonly"
              labelPrefix="Read-only"
              hint="Optional. A second credential, used for read-only sessions only."
            />
          </div>
        </Show>
        <Banner variant="secondary">
          Secrets are sealed before storage and never shown again.
        </Banner>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save adapter
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}
