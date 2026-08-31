import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show } from "solid-js";
import type { ApiToken } from "@testate/shared";

import { formatWhen } from "@/lib/format.ts";
import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, EmptyRow, TableFooter } from "@/components/table.tsx";
import { KIND_OPTIONS, ROLE_OPTIONS, createTokensPresenter } from "./tokens.presenter.ts";
import type { TokensPresenter } from "./tokens.presenter.ts";
import RevealDialog from "./tokens.reveal.view.tsx";

/** A revoked token stays "revoked" forever; short of that, a token past its own date reads
 *  as "expired" rather than the misleading "active" a stale expiry check used to leave it at. */
function tokenStatus(token: ApiToken) {
  if (token.revoked_at !== null) return { label: "revoked", variant: "secondary" } as const;
  if (token.expires_at !== null && new Date(token.expires_at).getTime() < Date.now()) {
    return { label: "expired", variant: "warning" } as const;
  }
  return { label: "active", variant: "success" } as const;
}

function CreateDialog(props: { presenter: TokensPresenter }): JSX.Element {
  const guard = createFormGuard();
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New API token"
      description="Standard tokens act as their role on the REST API. Agent tokens are viewer-only and reach the MCP endpoint alone."
    >
      <form
        ref={guard.ref}
        novalidate
        class="grid gap-4"
        onSubmit={(event) => {
          if (!guard.accepts(event)) return;
          void props.presenter.create();
        }}
      >
        <FormErrors errors={guard.errors()} />
        <label class="grid gap-1.5 text-base">
          <span>Name</span>
          <Input
            required
            maxlength="80"
            value={props.presenter.draft().name}
            onInput={(event) => props.presenter.setDraft({ name: event.currentTarget.value })}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>Kind</span>
          <Select
            options={KIND_OPTIONS}
            value={props.presenter.draft().kind}
            onChange={(kind) => props.presenter.setDraft({ kind })}
          />
        </label>
        <Show when={props.presenter.draft().kind === "standard"}>
          <label class="grid gap-1.5 text-base">
            <span>Role</span>
            <Select
              options={ROLE_OPTIONS}
              value={props.presenter.draft().role}
              onChange={(role) => props.presenter.setDraft({ role })}
            />
          </label>
        </Show>
        <label class="grid gap-1.5 text-base">
          <span>
            {props.presenter.draft().kind === "agent"
              ? "Expires on (default 90 days, at most 365)"
              : "Expires on (optional)"}
          </span>
          <Input
            type="date"
            value={props.presenter.draft().expires_on}
            onInput={(event) => props.presenter.setDraft({ expires_on: event.currentTarget.value })}
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

export default function TokensView(): JSX.Element {
  const presenter = createTokensPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="API tokens"
        description="Personal tokens act as their role; agent tokens are viewer-only and reach the MCP endpoint alone."
        actions={
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New token
          </Button>
        }
      />
      <Loading fallback={<p class="text-muted">Loading tokens...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Name</Head>
              <Head>Kind</Head>
              <Head>Role</Head>
              <Head>Prefix</Head>
              <Head>Last used</Head>
              <Head>Expires</Head>
              <Head>Status</Head>
              <Head pinned />
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No tokens yet. Create one for CI, or for an agent that may only read.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(token) => {
                  const status = tokenStatus(token);
                  return (
                    <Row>
                      <Cell class="font-semibold">{token.name}</Cell>
                      <Cell>
                        <Badge variant={token.kind === "agent" ? "info" : "outline"}>
                          {token.kind}
                        </Badge>
                      </Cell>
                      <Cell>{token.role}</Cell>
                      <Cell>
                        <code>{token.prefix}</code>
                      </Cell>
                      <Cell class="whitespace-nowrap">
                        <Show when={token.last_used_at} fallback="never">
                          {(at) => <>{formatWhen(at())}</>}
                        </Show>
                      </Cell>
                      <Cell class="whitespace-nowrap">
                        <Show when={token.expires_at} fallback="no expiry">
                          {(at) => <>{formatWhen(at())}</>}
                        </Show>
                      </Cell>
                      <Cell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </Cell>
                      <Cell pinned>
                        <Show when={token.revoked_at === null}>
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => presenter.askRevoke(token)}
                          >
                            Revoke
                          </Button>
                        </Show>
                      </Cell>
                    </Row>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter shown={presenter.value().length} noun="tokens" hasMore={presenter.hasMore()}>
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
      <CreateDialog presenter={presenter} />
      <RevealDialog presenter={presenter} />
      <ConfirmDialog
        open={presenter.revoking() !== null}
        title={`Revoke ${presenter.revoking()?.name ?? ""}`}
        description="Every request carrying this token fails from now on. It cannot be undone."
        confirmLabel="Revoke the token"
        onConfirm={() => void presenter.revoke()}
        onCancel={() => presenter.cancelRevoke()}
      />
    </section>
  );
}
