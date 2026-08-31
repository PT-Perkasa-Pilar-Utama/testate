import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import type { Session } from "./account.model.ts";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
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
      <div class="grid gap-1">
        <h3 class="text-base font-semibold text-heading">Change password</h3>
        <p class="text-sm text-muted">This signs you out of every other session.</p>
      </div>
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
            <Show when={props.presenter.password.busy()}>
              <Icon name="loader-circle" class="h-3.5 w-3.5 animate-spin" />
            </Show>
            {props.presenter.password.busy() ? "Saving..." : "Save password"}
          </Button>
        </div>
      </form>
    </LayerCard>
  );
}

/**
 * A row for one session. The current one carries an accent rail down its left edge, the same
 * treatment `Head`'s pinned column uses, so it reads before you get to the Actions column at all.
 */
function SessionRow(props: { presenter: AccountPresenter; session: Session }): JSX.Element {
  return (
    <Row class={props.session.current ? "shadow-[inset_2px_0_0_0_var(--color-accent)]" : undefined}>
      <Cell class="whitespace-nowrap">
        <span class="flex items-center gap-2">
          {formatWhen(props.session.created_at)}
          <Show when={props.session.current}>
            <Badge variant="info">current</Badge>
          </Show>
        </span>
      </Cell>
      <Cell class="whitespace-nowrap">{formatWhen(props.session.last_seen_at)}</Cell>
      <Cell>{props.session.ip ?? ""}</Cell>
      <Cell class="max-w-xs truncate">{props.session.user_agent ?? ""}</Cell>
      <Cell pinned>
        <Show when={!props.session.current}>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void props.presenter.revoke(props.session)}
          >
            <Icon name="log-out" class="h-3 w-3" />
            Sign out
          </Button>
        </Show>
      </Cell>
    </Row>
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
        <div class="grid gap-1">
          <h3 class="text-base font-semibold text-heading">Sessions</h3>
          <p class="text-sm text-muted">
            Every device signed in as you. Sign out any you don't recognise.
          </p>
        </div>
        <Loading fallback={<p class="text-muted">Loading sessions...</p>}>
          <Table>
            <thead>
              <tr>
                <Head>Started</Head>
                <Head>Last seen</Head>
                <Head>Address</Head>
                <Head>Browser</Head>
                <Head pinned />
              </tr>
            </thead>
            <tbody>
              <For each={presenter.sessions.value()}>
                {(session) => <SessionRow presenter={presenter} session={session} />}
              </For>
            </tbody>
          </Table>
        </Loading>
      </LayerCard>
    </section>
  );
}
