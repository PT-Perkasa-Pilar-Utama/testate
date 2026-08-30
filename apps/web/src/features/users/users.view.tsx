import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show } from "solid-js";
import type { User } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, TableFooter, EmptyRow } from "@/components/table.tsx";
import { ROLE_OPTIONS, createUsersPresenter } from "./users.presenter.ts";
import type { UsersPresenter } from "./users.presenter.ts";

function CreateDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New user"
      description="Hand the temporary password over out of band. The first login forces a change."
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
        <label class="grid gap-1.5 text-base">
          <span>Username</span>
          <Input
            required
            pattern={"[a-z0-9._\\-]{3,64}"}
            autocomplete="off"
            value={props.presenter.draft().username}
            onInput={(event) => props.presenter.setDraft({ username: event.currentTarget.value })}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>Display name</span>
          <Input
            required
            value={props.presenter.draft().display_name}
            onInput={(event) =>
              props.presenter.setDraft({ display_name: event.currentTarget.value })
            }
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>Role</span>
          <Select
            options={ROLE_OPTIONS}
            value={props.presenter.draft().role}
            onChange={(role) => props.presenter.setDraft({ role })}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>Temporary password</span>
          <Input
            type="password"
            required
            autocomplete="new-password"
            value={props.presenter.draft().temporary_password}
            onInput={(event) =>
              props.presenter.setDraft({ temporary_password: event.currentTarget.value })
            }
          />
        </label>
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
      </form>
    </Dialog>
  );
}

function ResetDialog(props: { presenter: UsersPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.resetPassword();
  };
  return (
    <Dialog
      open={props.presenter.resetting() !== null}
      onClose={() => props.presenter.closeReset()}
      title={`Reset password for ${props.presenter.resetting()?.username ?? ""}`}
      description="Every session of this user ends. The next login forces a change."
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
        <label class="grid gap-1.5 text-base">
          <span>Temporary password (12+ characters)</span>
          <Input
            type="password"
            required
            minlength="12"
            autocomplete="new-password"
            value={props.presenter.temporaryPassword()}
            onInput={(event) => props.presenter.setTemporaryPassword(event.currentTarget.value)}
          />
        </label>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeReset()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Reset
          </Button>
        </div>
      </form>
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
      <Loading fallback={<p class="text-kumo-subtle">Loading users...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Username</Head>
              <Head>Name</Head>
              <Head>Role</Head>
              <Head>Status</Head>
              <Head>Last login</Head>
              <Head />
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>No users yet. Add one to give a tester their own account.</EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(user) => (
                  <Row>
                    <Cell class="font-semibold whitespace-nowrap">{user.username}</Cell>
                    <Cell>{user.display_name}</Cell>
                    <Cell>
                      <Badge variant="outline">{user.role}</Badge>
                    </Cell>
                    <Cell>
                      <span class="inline-flex gap-1">
                        <Badge variant={user.disabled_at === null ? "success" : "secondary"}>
                          {user.disabled_at === null ? "active" : "disabled"}
                        </Badge>
                        <Show when={user.must_change_password}>
                          <Badge variant="warning">password change due</Badge>
                        </Show>
                        <Show when={user.locked_until !== null}>
                          <Badge variant="error">locked</Badge>
                        </Show>
                      </span>
                    </Cell>
                    <Cell>{user.last_login_at ?? "never"}</Cell>
                    <Cell>
                      <Actions presenter={presenter} user={user} />
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
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
