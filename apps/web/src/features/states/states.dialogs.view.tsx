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
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import type { StatesPresenter } from "./states.presenter.ts";

const EMPTY_DRAFT: StateDraftInput = { name: "", notes: "", tags: "", adapter_ids: [] };

/** Name, notes and tags: the fields the take and edit dialogs share, off one schema. */
function DraftFields(props: {
  form: FormStore<typeof stateDraftSchema>;
  /** Examples in the empty boxes; the edit dialog shows the record's own values instead. */
  hints?: boolean | undefined;
}): JSX.Element {
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
              placeholder={props.hints === true ? "after-the-failed-refund" : ""}
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
              rows="2"
              maxlength="4000"
              placeholder={
                props.hints === true ? "What the databases hold right now, in a sentence." : ""
              }
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
            <FieldLabel
              required={false}
              help="Comma separated. A tag is a word to find the state by."
            >
              Tags
            </FieldLabel>
            <Input
              {...field.props}
              type="text"
              autocomplete="off"
              placeholder={props.hints === true ? "bug-4182, release-2.4" : ""}
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

function Actions(props: {
  presenter: StatesPresenter;
  submit: string;
  /** The product's own verb wears the accent and the camera. */
  accent?: boolean | undefined;
}): JSX.Element {
  return (
    <DialogActions>
      <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
        Cancel
      </Button>
      <Button type="submit" variant={props.accent === true ? "accent" : "primary"}>
        <Show when={props.accent}>
          <Icon name="camera" class="h-4 w-4" />
        </Show>
        {props.submit}
      </Button>
    </DialogActions>
  );
}

export function TakeDialog(props: {
  presenter: StatesPresenter;
  /** The page's shutter, awaited: the snapshot is taken once the iris has opened again. */
  onShutter?: (() => Promise<void>) | undefined;
}): JSX.Element {
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
  // Like a camera: the form is the aim, Take is the shutter, and the picture is written after.
  // The dialog closes first, since a <dialog> sits above any overlay; the shutter runs to its end;
  // then the snapshot is queued and the toast says so. A refusal reopens the dialog with its reason.
  const take = async (input: StateDraftInput): Promise<void> => {
    props.presenter.close();
    await props.onShutter?.();
    if (!(await props.presenter.take(input))) props.presenter.reopenTake();
  };
  return (
    <FormDialog
      open={props.presenter.taking()}
      onClose={props.presenter.close}
      title="Snapshot"
      size="lg"
      description="Every database of the project, as it is right now."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => take(input)}>
        <DraftFields form={form} hints />
        {/* Every database, always: a snapshot is the project at one moment, and a state that
            skips a database is not that. The list says what is in the frame; it is not a choice.
            The API keeps `adapter_ids` for automation that knows what it is doing. */}
        <div class="viewfinder grid gap-2 p-4 text-sm">
          <span class="px-1 font-mono text-[11px] tracking-[0.12em] text-accent uppercase">
            In the frame
          </span>
          <Loading fallback={<p class="text-muted">Listing databases...</p>}>
            <ul class="flex flex-wrap gap-2" aria-label="Databases in this snapshot">
              <For each={props.presenter.databases.value()}>
                {(adapter) => (
                  <li class="flex min-w-0 items-center gap-1.5 rounded-md bg-fill px-2.5 py-1.5 ring ring-line">
                    <Icon name="database" class="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span class="max-w-[12rem] truncate" title={adapter.name}>
                      {adapter.name}
                    </span>
                    <span class="shrink-0 text-muted">{engineLabel(adapter.engine)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Loading>
        </div>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Take" accent />
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
