import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show, createSignal } from "solid-js";

import { formatWhen } from "@/lib/format.ts";
import { activeFilterCount } from "@/lib/table.ts";
import { ROLE_LABEL, ROLE_OPTIONS } from "@/lib/labels.ts";
import type { User } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { Menu, MenuItem } from "@/components/menu.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import LoadMore from "@/components/load-more.tsx";
import Icon from "@/components/icon.tsx";
import Select from "@/components/select.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  SortColumn,
  Table,
  TableFooter,
  TableSearch,
  Truncated,
} from "@/components/table.tsx";
import { createUsersPresenter } from "./users.presenter.ts";
import { CreateDialog, EditDialog, ResetDialog } from "./users.dialogs.view.tsx";
import type { UsersPresenter } from "./users.presenter.ts";

/** "" reads as "every role" in the select, and as "no filter" to the API. `as const` keeps it the
 *  literal `""` rather than `string`, or `Select` could not infer `Role | ""` from the union. */
const ROLE_FILTER_OPTIONS = [{ value: "" as const, label: "All roles" }, ...ROLE_OPTIONS];

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

/**
 * The one you usually want, and a menu for the rest.
 *
 * Four buttons a row put a red Delete in front of every account and wrapped onto two lines on a
 * narrow window, which is the shape `Menu` exists for and every other table here already uses.
 */
function Actions(props: { presenter: UsersPresenter; user: User }): JSX.Element {
  const disabled = (): boolean => props.user.disabled_at !== null;
  return (
    <div class="flex items-center justify-end gap-1">
      <Button size="xs" variant="outline" onClick={() => props.presenter.openEdit(props.user)}>
        Edit
      </Button>
      <Menu label={`More actions for ${props.user.username}`}>
        <MenuItem onClick={() => props.presenter.openReset(props.user)}>Reset password</MenuItem>
        <MenuItem onClick={() => void props.presenter.setDisabled(props.user, !disabled())}>
          {disabled() ? "Enable" : "Disable"}
        </MenuItem>
        <Show when={!props.presenter.isSelf(props.user)}>
          <MenuItem danger onClick={() => props.presenter.askRemove(props.user)}>
            Delete
          </MenuItem>
        </Show>
      </Menu>
    </div>
  );
}

export default function UsersView(): JSX.Element {
  const presenter = createUsersPresenter();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const activeCount = (): number => activeFilterCount(presenter.role() !== "");
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Users"
        description="Accounts on this instance. Roles are cumulative."
        actions={
          <>
            <TableSearch
              placeholder="Search users..."
              value={presenter.table.query()}
              onInput={(value) => presenter.table.setQuery(value)}
            />
            <FilterToggle
              open={filtersOpen()}
              active={activeCount()}
              onToggle={() => setFiltersOpen((open) => !open)}
            />
            <Button variant="primary" onClick={() => presenter.openCreate()}>
              New user
            </Button>
          </>
        }
      />
      <FilterPanel open={filtersOpen()}>
        <FilterField label="Role">
          <Select
            options={ROLE_FILTER_OPTIONS}
            value={presenter.role()}
            onChange={(role) => presenter.setRole(role)}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<p class="text-muted">Loading users...</p>}>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="username">
                Username
              </SortColumn>
              <SortColumn view={presenter.table} column="display_name">
                Name
              </SortColumn>
              <SortColumn view={presenter.table} column="role">
                Role
              </SortColumn>
              <Head>Status</Head>
              <SortColumn view={presenter.table} column="last_login_at">
                Last login
              </SortColumn>
              <Head pinned>Action</Head>
            </tr>
          </thead>
          <tbody>
            <Show when={presenter.table.rows().length === 0}>
              <EmptyRow>No account matches that search or filter.</EmptyRow>
            </Show>
            <For each={presenter.table.rows()}>
              {(user) => (
                <Row>
                  <Cell class="font-semibold">
                    <Truncated>{user.username}</Truncated>
                  </Cell>
                  <Cell>
                    <Truncated>{user.display_name}</Truncated>
                  </Cell>
                  <Cell>
                    <Badge variant={ROLE_META[user.role].variant}>
                      <Show when={ROLE_META[user.role].icon}>
                        {(icon) => <Icon name={icon()} class="h-3 w-3" />}
                      </Show>
                      {ROLE_LABEL[user.role]}
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
                  <Cell>
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
        <TableFooter
          shown={presenter.table.rows().length}
          noun="users"
          hasMore={presenter.hasMore()}
          total={presenter.total()}
        >
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
      <CreateDialog presenter={presenter} />
      <EditDialog presenter={presenter} />
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
