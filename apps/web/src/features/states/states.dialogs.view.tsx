import { Field, Form, createForm, reset } from "@formisch/solid";
import type { FormStore } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createEffect } from "solid-js";
import { deleteStateFormSchema, stateDraftSchema } from "@testate/shared";
import type { StateDraftInput } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import { engineLabel } from "@/lib/labels.ts";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import type { StatesPresenter } from "./states.presenter.ts";

const EMPTY_DRAFT: StateDraftInput = { name: "", notes: "", tags: "", adapter_ids: [] };

/** Name, notes and tags: the fields the take and edit dialogs share, off one schema. */
function DraftFields(props: { form: FormStore<typeof stateDraftSchema> }): JSX.Element {
  return (
    <>
      <Field of={props.form} path={["name"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={true}>Name</FieldLabel>
            <Input
              {...field.props}
              type="text"
              required
              maxlength="80"
              autocomplete="off"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["notes"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={false}>Notes</FieldLabel>
            <InputArea
              {...field.props}
              rows="3"
              maxlength="4000"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["tags"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={false}>Tags (comma separated)</FieldLabel>
            <Input
              {...field.props}
              type="text"
              autocomplete="off"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
    </>
  );
}

function Actions(props: { presenter: StatesPresenter; submit: string }): JSX.Element {
  return (
    <DialogActions>
      <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
        Cancel
      </Button>
      <Button type="submit" variant="primary">
        {props.submit}
      </Button>
    </DialogActions>
  );
}

export function TakeDialog(props: { presenter: StatesPresenter }): JSX.Element {
  // `adapter_ids` is an array, and an array with no initial input has no item stores: submit
  // then fails validation with nothing on screen to say so.
  const form = createForm({
    schema: stateDraftSchema,
    initialInput: { name: "", notes: "", tags: "", adapter_ids: [] },
  });
  createEffect(
    () => props.presenter.taking(),
    (open) => {
      if (open) onceSettled(() => reset(form, { initialInput: EMPTY_DRAFT }));
    }
  );
  return (
    <FormDialog
      open={props.presenter.taking()}
      onClose={props.presenter.close}
      title="Snapshot"
      size="lg"
      description="Every database is snapshotted at one point in time. Untick one to take a partial state."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.take(input)}>
        <DraftFields form={form} />
        <Field of={form} path={["adapter_ids"]}>
          {(field) => (
            <fieldset class="grid gap-1.5 text-sm">
              <legend>Databases</legend>
              <Loading fallback={<p class="text-muted">Listing adapters...</p>}>
                <For each={props.presenter.databases.value()}>
                  {(adapter) => (
                    <label class="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          (field.input ?? []).length === 0 ||
                          (field.input ?? []).includes(adapter.id)
                        }
                        onChange={() => {
                          const current = field.input ?? [];
                          field.onInput(
                            current.includes(adapter.id)
                              ? current.filter((id) => id !== adapter.id)
                              : [...current, adapter.id]
                          );
                        }}
                      />
                      {/* The dialog is only 24rem wide; an adapter name with no ceiling needs to
                          give way before the "(engine)" suffix does. */}
                      <span class="flex min-w-0 items-center gap-1">
                        <span class="min-w-0 truncate" title={adapter.name}>
                          {adapter.name}
                        </span>
                        <span class="shrink-0 text-muted">({engineLabel(adapter.engine)})</span>
                      </span>
                    </label>
                  )}
                </For>
              </Loading>
            </fieldset>
          )}
        </Field>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Take" />
      </Form>
    </FormDialog>
  );
}

export function EditDialog(props: { presenter: StatesPresenter }): JSX.Element {
  // `adapter_ids` is an array, and an array with no initial input has no item stores: submit
  // then fails validation with nothing on screen to say so.
  const form = createForm({
    schema: stateDraftSchema,
    initialInput: { name: "", notes: "", tags: "", adapter_ids: [] },
  });
  createEffect(
    () => props.presenter.editing(),
    (state) => {
      if (state !== null) {
        onceSettled(() =>
          reset(form, {
            initialInput: {
              name: state.name,
              notes: state.notes ?? "",
              tags: state.tags.join(", "),
              adapter_ids: [],
            },
          })
        );
      }
    }
  );
  return (
    <FormDialog
      size="lg"
      open={props.presenter.editing() !== null}
      onClose={props.presenter.close}
      title={`Edit ${props.presenter.editing()?.name ?? ""}`}
      description="Init states keep their kind. CI filters on it."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <DraftFields form={form} />
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Save" />
      </Form>
    </FormDialog>
  );
}

export function DeleteDialog(props: { presenter: StatesPresenter }): JSX.Element {
  const form = createForm({ schema: deleteStateFormSchema });
  return (
    <FormDialog
      open={props.presenter.deleting() !== null}
      onClose={props.presenter.close}
      title={`Delete ${props.presenter.deleting()?.name ?? ""}`}
      description="A job reclaims the storage this state holds alone. Checkout history keeps the name."
    >
      <Form of={form} class="grid gap-4" onSubmit={() => props.presenter.confirmDelete()}>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive">
            Delete state
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}
