import { Field, Form, createForm, reset, setInput } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { createEffect } from "solid-js";
import * as v from "valibot";

import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import { onceSettled } from "@/lib/form.ts";
import type { StoragePresenter } from "./storage.presenter.ts";

/**
 * A name, not a path.
 *
 * Both dialogs ask for one, and the presenter hangs it off the folder the browser is looking at.
 * A slash would take the file somewhere the person cannot see from here, and `..` is refused at
 * the other end anyway, so it is refused here where it can be said in words.
 */
const nameSchema = v.object({
  name: v.pipe(
    v.string(),
    v.minLength(1, "A name is required."),
    v.check((value) => !value.includes("/"), "A name cannot contain a slash."),
    v.check((value) => value !== "." && value !== "..", "That is not a name.")
  ),
});

function NameDialog(props: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  submit: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}): JSX.Element {
  const form = createForm({ schema: nameSchema });
  // The dialog stays mounted (design system rule: no conditional rendering), so a reopen would
  // otherwise show whatever the last one left behind.
  createEffect(
    () => ({ open: props.open, initial: props.initial }),
    ({ open, initial }) => {
      if (!open) return;
      onceSettled(() => {
        reset(form);
        setInput(form, { path: ["name"], input: initial });
      });
    }
  );
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      description={props.description}
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.onSubmit(input.name)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>{props.label}</FieldLabel>
              <Input
                {...field.props}
                required
                autocomplete="off"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {props.submit}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

export function RenameDialog(props: { presenter: StoragePresenter }): JSX.Element {
  return (
    <NameDialog
      open={props.presenter.renaming() !== null}
      title={`Rename ${props.presenter.renaming()?.name ?? ""}`}
      description="The file stays in this folder. Renaming it is done on the store itself."
      label="New name"
      submit="Rename"
      initial={props.presenter.renaming()?.name ?? ""}
      onClose={() => props.presenter.cancelRename()}
      onSubmit={(name) => props.presenter.rename(name)}
    />
  );
}

export function FolderDialog(props: { presenter: StoragePresenter }): JSX.Element {
  return (
    <NameDialog
      open={props.presenter.addingFolder()}
      title="New folder"
      description="An empty folder here. Uploading into a folder that is not there yet makes it anyway."
      label="Folder name"
      submit="Create"
      initial=""
      onClose={() => props.presenter.cancelFolder()}
      onSubmit={(name) => props.presenter.makeFolder(name)}
    />
  );
}

/** One file, and the batch, which says how many rather than naming them all. */
export function DeleteDialogs(props: { presenter: StoragePresenter }): JSX.Element {
  const count = (): number => props.presenter.picked().length;
  return (
    <>
      <ConfirmDialog
        open={props.presenter.deleting() !== null}
        title={`Delete ${props.presenter.deleting()?.name ?? ""}`}
        description="This removes the file from the store itself. Testate keeps no copy of it."
        confirmLabel="Delete"
        onCancel={() => props.presenter.cancelDelete()}
        onConfirm={() => void props.presenter.remove()}
      />
      {/*
        The title carries no count, and the count sentence is empty while nothing is ticked.

        A dialog stays mounted whether or not it is open (design system rule), so whatever is
        written here is in the page at all times. A title reading "Delete 0 entries" sat in the
        DOM behind the file listing and answered a search for the footer's own "0 entries".
      */}
      <ConfirmDialog
        open={props.presenter.picked().length > 0 && props.presenter.confirmingBatch()}
        title="Delete the selected"
        description={
          count() === 0
            ? "Nothing is selected."
            : `${count() === 1 ? "This entry is" : `These ${count()} entries are`} removed from the store itself. Testate keeps no copy of them, and a folder with anything in it is left alone.`
        }
        confirmLabel="Delete"
        onCancel={() => props.presenter.cancelBatch()}
        onConfirm={() => void props.presenter.removePicked()}
      />
    </>
  );
}
