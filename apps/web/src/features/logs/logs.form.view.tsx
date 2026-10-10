import {
  Field,
  FieldArray,
  Form,
  createForm,
  getInput,
  insert,
  reset,
  validate,
} from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, untrack } from "solid-js";
import type { LogTransport } from "@testate/shared";
import { logfileFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { onceSettled } from "@/lib/form.ts";
import { LOG_TRANSPORT_OPTIONS } from "@/lib/labels.ts";
import { FieldInput } from "../adapters/adapters.field-input.view.tsx";
import { ENGINE_FORMS } from "../adapters/adapters.fields.ts";
import { describeOutcome, outcomeWarnings } from "../adapters/adapters.presenter.ts";
import { BLANK_SOURCE } from "./logs.form.ts";
import { SourceFields } from "./logs.source.view.tsx";
import type { LogfileFormPresenter } from "./logs.form.ts";

/**
 * Add or edit a logfile adapter (S1): one SFTP or S3 connection, holding named sources. The
 * connection's fields are the storage engine's own, so a host or a bucket reads the same here.
 */
export function LogfileDialog(props: {
  presenter: LogfileFormPresenter;
  /** Offered when the dialog is not already inside a project: the Logs screen's case. */
  project?:
    | {
        options: { value: string; label: string }[];
        value: string;
        onChange: (slug: string) => void;
      }
    | undefined;
}): JSX.Element {
  const form = createForm({
    schema: logfileFormSchema,
    initialInput: untrack(() => props.presenter.seed()),
  });
  const transport = (): LogTransport => getInput(form, { path: ["transport"] }) ?? "sftp";
  const editing = (): boolean => props.presenter.editing() !== null;
  // The dialog stays mounted (design-system rule): every open starts from its own seed.
  createEffect(
    () => (props.presenter.open() ? props.presenter.seed() : null),
    (seed) => {
      if (seed !== null) onceSettled(() => reset(form, { initialInput: seed }));
    }
  );
  createEffect(
    () => transport(),
    () => {
      props.presenter.invalidateOutcome();
    }
  );
  const test = async (): Promise<void> => {
    const result = await validate(form, { shouldFocus: true });
    if (result.success) await props.presenter.test(result.output);
  };
  return (
    <FormDialog
      open={props.presenter.open()}
      onClose={props.presenter.close}
      title={editing() ? "Edit log adapter" : "New log adapter"}
      description="Read-only. Testate seals secrets before they reach the database and never shows them again."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Show when={props.project}>
          {(project) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Project</FieldLabel>
              <Select
                options={project().options}
                value={project().value}
                onChange={(slug) => project().onChange(slug)}
              />
            </label>
          )}
        </Show>
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
          {/* A different transport is a different set of secrets; delete and add again for that. */}
          <Field of={form} path={["transport"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Files over</span>
                <Select
                  options={LOG_TRANSPORT_OPTIONS}
                  value={field.input ?? "sftp"}
                  disabled={editing()}
                  onChange={(value) => field.onInput(value)}
                />
              </label>
            )}
          </Field>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={ENGINE_FORMS[transport()].config}>
            {(field) => <FieldInput presenter={props.presenter} field={field} prefix="config" />}
          </For>
          <For each={ENGINE_FORMS[transport()].secrets}>
            {(field) => (
              <FieldInput
                presenter={props.presenter}
                field={editing() ? { ...field, required: false, placeholder: "Unchanged" } : field}
                prefix="secret"
              />
            )}
          </For>
        </div>
        <FieldArray of={form} path={["sources"]}>
          {(sources) => (
            <div class="grid gap-3">
              <For each={sources.items}>
                {(_item, index) => (
                  <SourceFields form={form} index={index()} removable={sources.items.length > 1} />
                )}
              </For>
              <FieldError message={sources.errors?.[0]} />
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    insert(form, { path: ["sources"], initialInput: { ...BLANK_SOURCE } })
                  }
                >
                  <Icon name="plus" class="h-4 w-4" />
                  Add a source
                </Button>
              </div>
            </div>
          )}
        </FieldArray>
        <Show when={props.presenter.outcome()}>
          {(outcome) => (
            <>
              <Banner variant="default">{describeOutcome(outcome())}</Banner>
              <For each={outcomeWarnings(outcome())}>
                {(warning) => <Banner variant="alert">{warning}</Banner>}
              </For>
            </>
          )}
        </Show>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          {/* Saving an edit probes again; a test here would need the secrets the form never shows. */}
          <Show when={!editing()}>
            <Button
              type="button"
              variant="secondary"
              disabled={props.presenter.busy()}
              onClick={() => void test()}
            >
              Test connection
            </Button>
          </Show>
          <Button type="submit" variant="primary" disabled={props.presenter.busy()}>
            {editing() ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}
