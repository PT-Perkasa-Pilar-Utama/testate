import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, EmptyRow, TableFooter } from "@/components/table.tsx";
import { KIND_OPTIONS, ROLE_OPTIONS, createTokensPresenter } from "./tokens.presenter.ts";
import type { TokensPresenter } from "./tokens.presenter.ts";

function CreateDialog(props: { presenter: TokensPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New API token"
      description="Standard tokens act as their role on the REST API. Agent tokens are viewer-only and reach the MCP endpoint alone."
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
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

function CreatedBanner(props: { presenter: TokensPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.created()}>
      {(token) => (
        <LayerCard class="grid gap-3 px-5 py-4">
          <Banner variant="alert">Copy the token now. Testate shows it once.</Banner>
          <output class="block break-all rounded-md bg-kumo-tint px-3 py-2 font-mono text-sm">
            {token()}
          </output>
          <div class="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void props.presenter.copyCreated()}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.presenter.dismissCreated()}>
              Done
            </Button>
          </div>
        </LayerCard>
      )}
    </Show>
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
      <CreatedBanner presenter={presenter} />
      <Loading fallback={<p class="text-kumo-subtle">Loading tokens...</p>}>
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
              <Head />
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
                {(token) => (
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
                    <Cell>{token.last_used_at ?? "never"}</Cell>
                    <Cell>{token.expires_at ?? "no expiry"}</Cell>
                    <Cell>
                      <Badge variant={token.revoked_at === null ? "success" : "secondary"}>
                        {token.revoked_at === null ? "active" : "revoked"}
                      </Badge>
                    </Cell>
                    <Cell>
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
                )}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter shown={presenter.value().length} noun="tokens" hasMore={presenter.hasMore()}>
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
      <CreateDialog presenter={presenter} />
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
