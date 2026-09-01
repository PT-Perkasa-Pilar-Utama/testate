import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { onceSettled } from "@/lib/form.ts";
import { For, Loading, Show, createEffect } from "solid-js";
import type { ApiToken } from "@testate/shared";
import { tokenDraftSchema } from "@testate/shared";

import { formatWhen } from "@/lib/format.ts";
import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
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
  TableToolbar,
  Truncated,
} from "@/components/table.tsx";
import {
  EMPTY_DRAFT,
  KIND_OPTIONS,
  ROLE_OPTIONS,
  createTokensPresenter,
} from "./tokens.presenter.ts";
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
  const form = createForm({ schema: tokenDraftSchema, initialInput: EMPTY_DRAFT });
  // Dialogs stay mounted, so the form does not reset itself; put it back to a fresh draft
  // every time this one opens.
  createEffect(
    () => props.presenter.creating(),
    (creating) => {
      if (creating) onceSettled(() => reset(form, { initialInput: EMPTY_DRAFT }));
    }
  );
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New API token"
      description="Standard tokens act as their role on the REST API. Agent tokens are viewer-only and reach the MCP endpoint alone."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>Name</span>
              <Input
                {...field.props}
                required
                maxlength="80"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Field of={form} path={["kind"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>Kind</span>
              <Select
                options={KIND_OPTIONS}
                value={field.input ?? EMPTY_DRAFT.kind}
                onChange={(kind) => field.onInput(kind)}
              />
            </label>
          )}
        </Field>
        {/* Reads the kind field through `getInput`, not a sibling Field's own render-prop object,
            so this Show never chains off another Field's narrowed value. */}
        <Show when={getInput(form, { path: ["kind"] }) === "standard"}>
          <Field of={form} path={["role"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Role</span>
                <Select
                  options={ROLE_OPTIONS}
                  value={field.input ?? EMPTY_DRAFT.role}
                  onChange={(role) => field.onInput(role)}
                />
              </label>
            )}
          </Field>
        </Show>
        <Field of={form} path={["expires_on"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>
                {getInput(form, { path: ["kind"] }) === "agent"
                  ? "Expires on (default 90 days, at most 365)"
                  : "Expires on (optional)"}
              </span>
              <Input
                {...field.props}
                type="date"
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
        <TableToolbar>
          <TableSearch
            label="Search tokens"
            placeholder="name or prefix"
            value={presenter.table.query()}
            onInput={(value) => presenter.table.setQuery(value)}
          />
        </TableToolbar>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="name">
                Name
              </SortColumn>
              <SortColumn view={presenter.table} column="kind">
                Kind
              </SortColumn>
              <SortColumn view={presenter.table} column="role">
                Role
              </SortColumn>
              <Head>Prefix</Head>
              <SortColumn view={presenter.table} column="last_used_at">
                Last used
              </SortColumn>
              <SortColumn view={presenter.table} column="expires_at">
                Expires
              </SortColumn>
              <Head>Status</Head>
              <Head pinned />
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.table.rows().length > 0}
              fallback={
                <EmptyRow>
                  <Show
                    when={presenter.value().length > 0}
                    fallback="No tokens yet. Create one for CI, or for an agent that may only read."
                  >
                    No token matches that search.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(token) => {
                  const status = tokenStatus(token);
                  return (
                    <Row>
                      <Cell class="font-semibold">
                        <Truncated>{token.name}</Truncated>
                      </Cell>
                      <Cell>
                        <Badge variant={token.kind === "agent" ? "info" : "outline"}>
                          {token.kind}
                        </Badge>
                      </Cell>
                      <Cell>{token.role}</Cell>
                      <Cell>
                        <code>{token.prefix}</code>
                      </Cell>
                      <Cell>
                        <Show when={token.last_used_at} fallback="never">
                          {(at) => <>{formatWhen(at())}</>}
                        </Show>
                      </Cell>
                      <Cell>
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
        <TableFooter
          shown={presenter.table.rows().length}
          noun="tokens"
          hasMore={presenter.hasMore()}
        >
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
