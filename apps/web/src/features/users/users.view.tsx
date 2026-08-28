import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createUsersPresenter } from "./users.presenter.ts";

export default function UsersView(): JSX.Element {
  const presenter = createUsersPresenter();
  return (
    <section class="grid gap-6">
      <div class="grid gap-1.5">
        <h2 class="text-lg font-semibold">Users</h2>
        <p class="text-kumo-subtle">Accounts on this instance. Roles are cumulative.</p>
      </div>
      <Loading fallback={<p class="text-kumo-subtle">Loading users...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Username</Head>
              <Head>Name</Head>
              <Head>Role</Head>
              <Head>Status</Head>
              <Head>Last login</Head>
            </tr>
          </thead>
          <tbody>
            <For each={presenter.value()}>
              {(user) => (
                <Row>
                  <Cell>{user.username}</Cell>
                  <Cell>{user.display_name}</Cell>
                  <Cell>
                    <Badge variant="outline">{user.role}</Badge>
                  </Cell>
                  <Cell>
                    <Badge variant={user.disabled_at === null ? "success" : "secondary"}>
                      {user.disabled_at === null ? "active" : "disabled"}
                    </Badge>
                  </Cell>
                  <Cell>{user.last_login_at ?? "never"}</Cell>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
      </Loading>
    </section>
  );
}
