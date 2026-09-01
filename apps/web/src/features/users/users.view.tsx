import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show, createEffect } from "solid-js";

import { formatWhen } from "@/lib/format.ts";
import type { User } from "@testate/shared";
import { createUserSchema, resetPasswordSchema } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, TableFooter } from "@/components/table.tsx";
import { ROLE_OPTIONS, createUsersPresenter } from "./users.presenter.ts";
import type { UsersPresenter } from "./users.presenter.ts";

/**
 * Accent (`info`) is reserved for admin: the role that can do this to every other account. `qa`
 * covers both the tester and the engineer (`docs/UI_REWORK.md`) and needs no emphasis; `viewer`
 * reads quietest because it can change nothing.
 */
const ROLE_META = {
  admin: { variant: "info", icon: "shield" },
  qa: { variant: "outline", icon: undefined },
  viewer: { variant: "secondary", icon: undefined },
} as const;

function CreateDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const form = createForm({ schema: createUserSchema, initialInput: { role: "viewer" } });
  // The dialog stays mounted (design system rule: no conditional rendering), so a reopen would
  // otherwise show whatever the last attempt left behind.
  createEffect(
    () => props.presenter.creating(),
    (open) => {
      if (open) reset(form);
    }
  );
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New user"
      description="Hand the temporary password over out of band. The first login forces a change."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
        <Field of={form} path={["username"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Username</span>
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
            <label class="grid gap-1.5 text-base">
              <span>Display name</span>
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
            <label class="grid gap-1.5 text-base">
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
        <Field of={form} path={["temporary_password"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Temporary password</span>
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
    </Dialog>
  );
}

function ResetDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const form = createForm({ schema: resetPasswordSchema });
  // Same rule: the dialog is reused for whichever user was clicked, so a fresh open must not
  // carry the previous target's leftover input or errors.
  createEffect(
    () => props.presenter.resetting() !== null,
    (open) => {
      if (open) reset(form);
    }
  );
  return (
    <Dialog
      open={props.presenter.resetting() !== null}
      onClose={() => props.presenter.closeReset()}
      title={`Reset password for ${props.presenter.resetting()?.username ?? ""}`}
      description="Every session of this user ends. The next login forces a change."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.resetPassword(input)}>
        <Field of={form} path={["temporary_password"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Temporary password (12+ characters)</span>
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
    </Dialog>
  );
}

function Actions(props: { presenter: UsersPresenter; user: User }): JSX.Element {
  const disabled = (): boolean => props.user.disabled_at !== null;
  return (
    <div class="flex justify-end gap-1">
      <Button size="xs" variant="outline" onClick={() => props.presenter.openReset(props.user)}>
        Reset password
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={() => void props.presenter.setDisabled(props.user, !disabled())}
      >
        {disabled() ? "Enable" : "Disable"}
      </Button>
      <Show when={!props.presenter.isSelf(props.user)}>
        <Button
          size="xs"
          variant="destructive"
          onClick={() => props.presenter.askRemove(props.user)}
        >
          Delete
        </Button>
      </Show>
    </div>
  );
}

export default function UsersView(): JSX.Element {
  const presenter = createUsersPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Users"
        description="Accounts on this instance. Roles are cumulative."
        actions={
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New user
          </Button>
        }
      />
      <Loading fallback={<p class="text-muted">Loading users...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Username</Head>
              <Head>Name</Head>
              <Head>Role</Head>
              <Head>Status</Head>
              <Head>Last login</Head>
              <Head pinned />
            </tr>
          </thead>
          <tbody>
            <For each={presenter.value()}>
              {(user) => (
                <Row>
                  <Cell class="font-semibold whitespace-nowrap">{user.username}</Cell>
                  <Cell>{user.display_name}</Cell>
                  <Cell>
                    <Badge variant={ROLE_META[user.role].variant}>
                      <Show when={ROLE_META[user.role].icon}>
                        {(icon) => <Icon name={icon()} class="h-3 w-3" />}
                      </Show>
                      {user.role}
                    </Badge>
                  </Cell>
                  <Cell>
                    {/* Worst first: a locked or disabled account can't sign in no matter what
                        else is true of it, so that fact leads. "active" only appears when none
                        of the others do — a clean account needs one pill, not a default one. */}
                    <span class="inline-flex flex-wrap gap-1">
                      <Show when={user.locked_until !== null}>
                        <Badge variant="error">
                          <Icon name="lock" class="h-3 w-3" />
                          locked
                        </Badge>
                      </Show>
                      <Show when={user.disabled_at !== null}>
                        <Badge variant="secondary">disabled</Badge>
                      </Show>
                      <Show when={user.must_change_password}>
                        <Badge variant="warning">password change due</Badge>
                      </Show>
                      <Show
                        when={
                          user.locked_until === null &&
                          user.disabled_at === null &&
                          !user.must_change_password
                        }
                      >
                        <Badge variant="success">active</Badge>
                      </Show>
                    </span>
                  </Cell>
                  <Cell class="whitespace-nowrap">
                    <Show when={user.last_login_at} fallback="never">
                      {(at) => <>{formatWhen(at())}</>}
                    </Show>
                  </Cell>
                  <Cell pinned>
                    <Actions presenter={presenter} user={user} />
                  </Cell>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
        <TableFooter shown={presenter.value().length} noun="users" hasMore={presenter.hasMore()}>
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
      <CreateDialog presenter={presenter} />
      <ResetDialog presenter={presenter} />
      <ConfirmDialog
        open={presenter.removing() !== null}
        title={`Delete ${presenter.removing()?.username ?? ""}`}
        description="The account and its sessions go. Audit rows keep the name."
        confirmLabel="Delete the account"
        onConfirm={() => void presenter.remove()}
        onCancel={() => presenter.cancelRemove()}
      />
    </section>
  );
}
