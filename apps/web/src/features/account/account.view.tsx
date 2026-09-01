import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import { PASSWORD_MIN_LENGTH, changePasswordSchema } from "@testate/shared";
import type { ChangePasswordInput } from "@testate/shared";
import type { Session } from "./account.model.ts";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { actor } from "@/lib/session.ts";
import { createAccountPresenter } from "./account.presenter.ts";
import type { AccountPresenter } from "./account.presenter.ts";

function PasswordCard(props: { presenter: AccountPresenter }): JSX.Element {
  const form = createForm({ schema: changePasswordSchema });
  // A named function, not an inline async arrow: the linter reads any async arrow function
  // passed straight to a component prop as a tracked scope, which Solid's reactivity can only
  // follow synchronously.
  async function submit(input: ChangePasswordInput): Promise<void> {
    const changed = await props.presenter.changePassword(input);
    if (changed) reset(form);
  }
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <div class="grid gap-1">
        <h3 class="text-base font-semibold text-heading">Change password</h3>
        <p class="text-sm text-muted">This signs you out of every other session.</p>
      </div>
      <Form of={form} class="grid gap-3 sm:grid-cols-2" onSubmit={(input) => submit(input)}>
        <Field of={form} path={["current"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Current password</span>
              <Input
                {...field.props}
                type="password"
                required
                autocomplete="current-password"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Field of={form} path={["next"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>New password ({PASSWORD_MIN_LENGTH}+ characters)</span>
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
        {/* A refused current password is the server's answer, not a schema failure. */}
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
      </Form>
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
