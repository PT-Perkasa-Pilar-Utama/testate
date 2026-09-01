import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show, createSignal } from "solid-js";
import type { ApiToken } from "@testate/shared";

import { formatWhen } from "@/lib/format.ts";
import { activeFilterCount } from "@/lib/table.ts";
import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import LoadMore from "@/components/load-more.tsx";
import Select from "@/components/select.tsx";
import { ROLE_LABEL, TOKEN_KIND_LABEL, TOKEN_KIND_OPTIONS } from "@/lib/labels.ts";
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
import { createTokensPresenter } from "./tokens.presenter.ts";
import type { RevokedFilter, TokensPresenter } from "./tokens.presenter.ts";
import { CreateDialog } from "./tokens.dialogs.view.tsx";
import RevealDialog from "./tokens.reveal.view.tsx";

/** "" reads as "every kind" in the select, and as "no filter" to the API. `as const` keeps it the
 *  literal `""` rather than `string`, or `Select` could not infer `TokenKind | ""` from the union. */
const KIND_FILTER_OPTIONS = [{ value: "" as const, label: "All kinds" }, ...TOKEN_KIND_OPTIONS];

/** The `revoked` filter is tri-state at the API (unset, true, false); this names the states a
 *  person picks from, not the token's own status, which the table's Status column already reads
 *  off `revoked_at` and `expires_at` together. */
const REVOKED_FILTER_OPTIONS: { value: RevokedFilter; label: string }[] = [
  { value: "", label: "Any" },
  { value: "false", label: "Not revoked" },
  { value: "true", label: "Revoked" },
];

/** A revoked token stays "revoked" forever; short of that, a token past its own date reads
 *  as "expired" rather than the misleading "active" a stale expiry check used to leave it at. */
function tokenStatus(token: ApiToken) {
  if (token.revoked_at !== null) return { label: "revoked", variant: "secondary" } as const;
  if (token.expires_at !== null && new Date(token.expires_at).getTime() < Date.now()) {
    return { label: "expired", variant: "warning" } as const;
  }
  return { label: "active", variant: "success" } as const;
}

/** Search text, kind or revoked narrows the list; an empty result under any of them reads as
 *  "no matches", not as "no tokens", which is what the fallback text below has to tell apart. */
function isFiltered(presenter: TokensPresenter): boolean {
  return presenter.table.query() !== "" || presenter.kind() !== "" || presenter.revoked() !== "";
}

export default function TokensView(): JSX.Element {
  const presenter = createTokensPresenter();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const activeCount = (): number =>
    activeFilterCount(presenter.kind() !== "", presenter.revoked() !== "");
  return (
    <section class="grid gap-6">
      <PageHeader
        title="API tokens"
        description="Personal tokens act as their role on the REST API; agent tokens reach the MCP endpoint alone, where a Guest reads and a Tester also writes."
        actions={
          <>
            <TableSearch
              placeholder="Search tokens..."
              value={presenter.table.query()}
              onInput={(value) => presenter.table.setQuery(value)}
            />
            <FilterToggle
              open={filtersOpen()}
              active={activeCount()}
              onToggle={() => setFiltersOpen((open) => !open)}
            />
            <Button variant="primary" onClick={() => presenter.openCreate()}>
              New token
            </Button>
          </>
        }
      />
      <FilterPanel open={filtersOpen()}>
        <FilterField label="Kind">
          <Select
            options={KIND_FILTER_OPTIONS}
            value={presenter.kind()}
            onChange={(kind) => presenter.setKind(kind)}
          />
        </FilterField>
        <FilterField label="Revoked">
          <Select
            options={REVOKED_FILTER_OPTIONS}
            value={presenter.revoked()}
            onChange={(revoked) => presenter.setRevoked(revoked)}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<p class="text-muted">Loading tokens...</p>}>
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
                    when={isFiltered(presenter)}
                    fallback="No tokens yet. Create one for CI, or for an agent that may only read."
                  >
                    No token matches that search or filter.
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
                          {TOKEN_KIND_LABEL[token.kind]}
                        </Badge>
                      </Cell>
                      <Cell>{ROLE_LABEL[token.role]}</Cell>
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
          total={presenter.total()}
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
