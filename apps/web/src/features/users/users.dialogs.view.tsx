import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show, createEffect } from "solid-js";
import { createUserSchema, editUserFormSchema, resetPasswordSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { ROLE_OPTIONS } from "@/lib/labels.ts";
import type { UsersPresenter } from "./users.presenter.ts";

export function CreateDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const form = createForm({ schema: createUserSchema, initialInput: { role: "viewer" } });
  // The dialog stays mounted (design system rule: no conditional rendering), so a reopen would
  // otherwise show whatever the last attempt left behind.
  createEffect(
    () => props.presenter.creating(),
    (open) => {
      if (open) onceSettled(() => reset(form));
    }
  );
  return (
    <FormDialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New user"
      size="lg"
      description="Hand the temporary password over out of band. The first login forces a change."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
        <div class="grid gap-3 sm:grid-cols-2">
          <Field of={form} path={["username"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <FieldLabel required={true}>Username</FieldLabel>
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
          <Field of={form} path={["display_name"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <FieldLabel required={true}>Display name</FieldLabel>
                <Input
                  {...field.props}
                  required
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          <Field of={form} path={["role"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Role</span>
                <Select
                  options={ROLE_OPTIONS}
                  value={field.input ?? "viewer"}
                  onChange={(role) => field.onInput(role)}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
        </div>
        <Field of={form} path={["temporary_password"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Temporary password</FieldLabel>
              <Input
                {...field.props}
                type="password"
                required
                autocomplete="new-password"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </div>
      </Form>
    </FormDialog>
  );
}

/**
 * Changing a person's display name or role (story 151).
 *
 * The API has always taken this; nothing called it, so promoting a viewer meant deleting the
 * account and making a new one. The refusal that matters, demoting the last enabled admin, is the
 * server's to make and arrives as a banner.
 */
export function EditDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const form = createForm({
    schema: editUserFormSchema,
    initialInput: { display_name: "", role: "viewer" },
  });
  createEffect(
    () => props.presenter.editing(),
    (user) => {
      if (user !== null) {
        onceSettled(() =>
          reset(form, { initialInput: { display_name: user.display_name, role: user.role } })
        );
      }
    }
  );
  return (
    <FormDialog
      open={props.presenter.editing() !== null}
      onClose={() => props.presenter.closeEdit()}
      title={`Edit ${props.presenter.editing()?.username ?? ""}`}
      description="The username never changes; it is what the audit log records."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.update(input)}>
        <Field of={form} path={["display_name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Display name</FieldLabel>
              <Input
                {...field.props}
                required
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Field of={form} path={["role"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>Role</span>
              <Select
                options={ROLE_OPTIONS}
                value={field.input ?? "viewer"}
                onChange={(role) => field.onInput(role)}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </Form>
    </FormDialog>
  );
}

export function ResetDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const form = createForm({ schema: resetPasswordSchema });
  // Same rule: the dialog is reused for whichever user was clicked, so a fresh open must not
  // carry the previous target's leftover input or errors.
  createEffect(
    () => props.presenter.resetting() !== null,
    (open) => {
      if (open) onceSettled(() => reset(form));
    }
  );
  return (
    <FormDialog
      open={props.presenter.resetting() !== null}
      onClose={() => props.presenter.closeReset()}
      title={`Reset password for ${props.presenter.resetting()?.username ?? ""}`}
      description="Every session of this user ends. The next login forces a change."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.resetPassword(input)}>
        <Field of={form} path={["temporary_password"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Temporary password (12+ characters)</FieldLabel>
              <Input
                {...field.props}
                type="password"
                required
                autocomplete="new-password"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeReset()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Reset
          </Button>
        </div>
      </Form>
    </FormDialog>
  );
}
