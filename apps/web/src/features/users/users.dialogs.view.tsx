import { Field, Form, createForm, getErrors, getInput, reset, setInput } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Loading, Show, createEffect } from "solid-js";
import type { Role, ScopeChoice } from "@testate/shared";
import { editUserFormSchema, resetPasswordSchema, userDraftSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Pending from "@/components/pending.tsx";
import ProjectScope from "@/components/project-scope.tsx";
import Select from "@/components/select.tsx";
import { ROLE_OPTIONS } from "@/lib/labels.ts";
import { editDraftOf } from "./users.presenter.ts";
import type { UsersPresenter } from "./users.presenter.ts";

/** Which projects a viewer or a tester reaches (#55); an admin has every project and is not asked. */
function ScopeField(props: {
  presenter: UsersPresenter;
  role: Role | undefined;
  scope: ScopeChoice | undefined;
  picked: readonly string[];
  onScope: (scope: ScopeChoice) => void;
  onPicked: (picked: string[]) => void;
  scopeError: string | undefined;
  pickedError: string | undefined;
}): JSX.Element {
  return (
    <Show when={props.role !== "admin"}>
      <Loading fallback={<Pending>Listing projects...</Pending>}>
        <ProjectScope
          projects={props.presenter.projects.value()}
          scope={props.scope}
          picked={props.picked}
          onScope={props.onScope}
          onPicked={props.onPicked}
          scopeError={props.scopeError}
          pickedError={props.pickedError}
        />
      </Loading>
    </Show>
  );
}

export function CreateDialog(props: { presenter: UsersPresenter }): JSX.Element {
  // The scope starts unanswered on purpose: nobody gets projects nobody chose (#55, Q3).
  const form = createForm({
    schema: userDraftSchema,
    initialInput: { role: "viewer", scope: undefined, project_ids: [] },
  });
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
      onClose={props.presenter.closeCreate}
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
        <ScopeField
          presenter={props.presenter}
          role={getInput(form, { path: ["role"] })}
          scope={getInput(form, { path: ["scope"] })}
          picked={getInput(form, { path: ["project_ids"] }) ?? []}
          onScope={(scope) => setInput(form, { path: ["scope"], input: scope })}
          onPicked={(picked) => setInput(form, { path: ["project_ids"], input: picked })}
          scopeError={getErrors(form, { path: ["scope"] })?.[0]}
          pickedError={getErrors(form, { path: ["project_ids"] })?.[0]}
        />
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </DialogActions>
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
    initialInput: { display_name: "", role: "viewer", project_ids: [] },
  });
  createEffect(
    () => props.presenter.editing(),
    (user) => {
      if (user !== null) onceSettled(() => reset(form, { initialInput: editDraftOf(user) }));
    }
  );
  return (
    <FormDialog
      size="lg"
      open={props.presenter.editing() !== null}
      onClose={props.presenter.closeEdit}
      title={`Edit ${props.presenter.editing()?.username ?? ""}`}
      description="The username never changes. The audit log records it."
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
        <ScopeField
          presenter={props.presenter}
          role={getInput(form, { path: ["role"] })}
          scope={getInput(form, { path: ["scope"] })}
          picked={getInput(form, { path: ["project_ids"] }) ?? []}
          onScope={(scope) => setInput(form, { path: ["scope"], input: scope })}
          onPicked={(picked) => setInput(form, { path: ["project_ids"], input: picked })}
          scopeError={getErrors(form, { path: ["scope"] })?.[0]}
          pickedError={getErrors(form, { path: ["project_ids"] })?.[0]}
        />
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </DialogActions>
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
      size="lg"
      open={props.presenter.resetting() !== null}
      onClose={props.presenter.closeReset}
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
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeReset()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Reset
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}
