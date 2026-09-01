import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LoadMore from "@/components/load-more.tsx";
import Select from "@/components/select.tsx";
import { AUDIT_OUTCOME_LABEL } from "@/lib/labels.ts";
import {
  Cell,
  Head,
  Row,
  Table,
  EmptyRow,
  TableFooter,
  TableToolbar,
  Truncated,
} from "@/components/table.tsx";
import { OUTCOMES, createAuditPresenter } from "./audit.presenter.ts";
import type { AuditPresenter } from "./audit.presenter.ts";

const OUTCOME_VARIANT = { succeeded: "success", failed: "error", partial: "warning" } as const;
// Who acted, at a glance, without reading "user"/"token"/"system" on every row. Keyed to match
// `AuditRow["actor"]["kind"]` exactly, so indexing by it needs no cast.
const ACTOR_ICON = { user: "user", token: "key-round", system: "terminal" } as const;

function hasFilter(filter: AuditPresenter["filter"]): boolean {
  const current = filter();
  return current.action !== "" || current.actor !== "" || current.outcome !== "";
}

/** The API has filtered by action, actor and outcome since it was written. This is the screen. */
function Filters(props: { presenter: AuditPresenter }): JSX.Element {
  return (
    <TableToolbar
      actions={
        <Show when={hasFilter(props.presenter.filter)}>
          <Button size="sm" variant="ghost" onClick={() => props.presenter.clearFilter()}>
            Clear filters
          </Button>
        </Show>
      }
    >
      <label class="grid gap-1.5 text-sm">
        <span>Action</span>
        <Input
          placeholder="auth.login"
          value={props.presenter.filter().action}
          onInput={(event) => props.presenter.setFilter({ action: event.currentTarget.value })}
        />
      </label>
      <label class="grid gap-1.5 text-sm">
        <span>Actor</span>
        <Input
          placeholder="qa-user"
          value={props.presenter.filter().actor}
          onInput={(event) => props.presenter.setFilter({ actor: event.currentTarget.value })}
        />
      </label>
      <label class="grid gap-1.5 text-sm">
        <span>Outcome</span>
        <Select
          options={OUTCOMES.map((value) => ({
            value,
            label: value === "" ? "any" : AUDIT_OUTCOME_LABEL[value],
          }))}
          value={props.presenter.filter().outcome}
          onChange={(outcome) => props.presenter.setFilter({ outcome })}
        />
      </label>
    </TableToolbar>
  );
}

export default function AuditView(): JSX.Element {
  const presenter = createAuditPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader title="Audit log" description="Every write, by whom, and how it ended." />
      <Filters presenter={presenter} />
      <Loading fallback={<p class="text-muted">Loading audit rows...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>When</Head>
              <Head>Actor</Head>
              <Head>Action</Head>
              <Head>Target</Head>
              <Head>Project</Head>
              <Head>Outcome</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  <Show
                    when={hasFilter(presenter.filter)}
                    fallback="Nothing in the audit log yet. Every login and every change lands here."
                  >
                    No rows match this filter. Try a broader action or actor, or clear it.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(row) => (
                  <Row>
                    <Cell class="whitespace-nowrap tabular-nums">{formatWhen(row.created_at)}</Cell>
                    <Cell class="whitespace-nowrap">
                      <span class="inline-flex items-center gap-1.5">
                        <Icon
                          name={ACTOR_ICON[row.actor.kind]}
                          class="h-3.5 w-3.5 shrink-0 text-muted"
                        />
                        {/* actor.label is a username (<=64) for a user row but a token's own name
                            for a token row, and token names carry no length cap. */}
                        <span class="max-w-[12rem] truncate" title={row.actor.label}>
                          {row.actor.label}
                        </span>
                      </span>
                    </Cell>
                    <Cell>
                      {/* action is an internal event name with no defined cap ("module.verb"),
                          unlike the enum-backed columns beside it. */}
                      <code class="block max-w-[18rem] truncate" title={row.action}>
                        {row.action}
                      </code>
                    </Cell>
                    <Cell class="whitespace-nowrap">
                      {/* target_type is one of a short, fixed set of internal type names; the
                          risk is target_id, which is usually a UUID (36 chars) but is sometimes a
                          raw username or another table's primary key with no cap of its own. 20rem
                          fits "<type> <uuid>" without truncating the common case. */}
                      <code
                        class="block max-w-[20rem] truncate text-xs text-muted"
                        title={`${row.target_type} ${row.target_id}`}
                      >
                        {row.target_type} {row.target_id}
                      </code>
                    </Cell>
                    <Cell>
                      {/* A slug is 2-64 chars with no spaces, the same shape as the username that
                          broke the users table. Narrower than a stacked name/slug/description
                          block gets (28rem elsewhere): here it's the only thing in the column. */}
                      <Truncated class="max-w-[12rem]">{row.project?.slug ?? ""}</Truncated>
                    </Cell>
                    <Cell>
                      <Badge
                        variant={row.outcome === null ? "secondary" : OUTCOME_VARIANT[row.outcome]}
                      >
                        {row.outcome === null ? "n/a" : AUDIT_OUTCOME_LABEL[row.outcome]}
                      </Badge>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter
          shown={presenter.value().length}
          noun="rows"
          hasMore={presenter.hasMore()}
          total={presenter.total()}
        >
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
    </section>
  );
}
