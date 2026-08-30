import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { actor } from "@/lib/session.ts";
import { createAccountPresenter } from "./account.presenter.ts";
import type { AccountPresenter } from "./account.presenter.ts";

function PasswordCard(props: { presenter: AccountPresenter }): JSX.Element {
  const guard = createFormGuard();
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <h3 class="font-medium">Change password</h3>
      <form
        ref={guard.ref}
        novalidate
        class="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          if (!guard.accepts(event)) return;
          void props.presenter.changePassword();
        }}
      >
        <FormErrors errors={guard.errors()} />
        <label class="grid gap-1.5 text-base">
          <span>Current password</span>
          <Input
            type="password"
            required
            autocomplete="current-password"
            value={props.presenter.password.current()}
            onInput={(event) => props.presenter.password.setCurrent(event.currentTarget.value)}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>New password (12+ characters)</span>
          <Input
            type="password"
            required
            autocomplete="new-password"
            value={props.presenter.password.next()}
            onInput={(event) => props.presenter.password.setNext(event.currentTarget.value)}
          />
        </label>
        <Show when={props.presenter.password.error()}>
          {(message) => (
            <div class="sm:col-span-2">
              <Banner variant="error">{message()}</Banner>
            </div>
          )}
        </Show>
        <div class="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={props.presenter.password.busy()}>
            Save password
          </Button>
        </div>
      </form>
    </LayerCard>
  );
}

export default function AccountView(): JSX.Element {
  const presenter = createAccountPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Account"
        description={`Signed in as ${actor()?.label ?? ""} (${actor()?.role ?? ""}).`}
      />
      <PasswordCard presenter={presenter} />
      <LayerCard class="grid gap-3 px-5 py-4">
        <h3 class="font-medium">Sessions</h3>
        <Loading fallback={<p class="text-kumo-subtle">Loading sessions...</p>}>
          <Table>
            <thead>
              <tr>
                <Head>Started</Head>
                <Head>Last seen</Head>
                <Head>Address</Head>
                <Head>Browser</Head>
                <Head />
              </tr>
            </thead>
            <tbody>
              <For each={presenter.sessions.value()}>
                {(session) => (
                  <Row>
                    <Cell>{formatWhen(session.created_at)}</Cell>
                    <Cell>{formatWhen(session.last_seen_at)}</Cell>
                    <Cell>{session.ip ?? ""}</Cell>
                    <Cell class="max-w-xs truncate">{session.user_agent ?? ""}</Cell>
                    <Cell>
                      <Show
                        when={!session.current}
                        fallback={<Badge variant="success">this session</Badge>}
                      >
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void presenter.revoke(session)}
                        >
                          Sign out
                        </Button>
                      </Show>
                    </Cell>
                  </Row>
                )}
              </For>
            </tbody>
          </Table>
        </Loading>
      </LayerCard>
    </section>
  );
}
