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
          <FieldLabel
            required={field.required === true && props.hint === undefined}
            help={props.hint ?? field.hint}
          >
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
      description="A new name keeps everything. A new host or database takes a new init state."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        {/* Two columns throughout: the dialog used to stack every field and put Save below a
            scroll. What belongs together sits side by side, and the whole form is one screen. */}
        <div class="grid gap-3 sm:grid-cols-2">
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
            <Field of={form} path={["lock_timeout_ms"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <FieldLabel
                    required={false}
                    help="Milliseconds a restore waits for a table lock."
                  >
                    Lock timeout
                  </FieldLabel>
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
          </Show>
        </div>
        <Show when={props.adapter.kind === "database"}>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field of={form} path={["excluded_tables"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <FieldLabel
                    required={false}
                    help="Comma separated. Migration tables are always excluded."
                  >
                    Excluded tables
                  </FieldLabel>
                  <Input
                    {...field.props}
                    placeholder="audit_log, sessions"
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
                    <FieldLabel
                      required={false}
                      help="Comma separated. Empty means every schema but the system's."
                    >
                      Schemas
                    </FieldLabel>
                    <Input
                      {...field.props}
                      placeholder="public"
                      value={field.input}
                      variant={field.errors ? "error" : "default"}
                      aria-invalid={field.errors ? "true" : undefined}
                    />
                    <FieldError message={field.errors?.[0]} />
                  </label>
                )}
              </Field>
            </Show>
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
          <Show when={props.adapter.kind === "database"}>
            <Fields
              presenter={props.presenter}
              fields={engineForm().secrets}
              prefix="readonly"
              labelPrefix="Read-only"
              hint="For read-only sessions. Blank keeps the one on record."
            />
          </Show>
        </div>
        <Banner variant="secondary">
          Testate seals secrets before storage. It never shows them again.
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
