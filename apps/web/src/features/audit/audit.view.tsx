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
import {
  Cell,
  Head,
  Row,
  Table,
  EmptyRow,
  TableFooter,
  TableToolbar,
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
          size="sm"
          placeholder="auth.login"
          value={props.presenter.filter().action}
          onInput={(event) => props.presenter.setFilter({ action: event.currentTarget.value })}
        />
      </label>
      <label class="grid gap-1.5 text-sm">
        <span>Actor</span>
        <Input
          size="sm"
          placeholder="qa-user"
          value={props.presenter.filter().actor}
          onInput={(event) => props.presenter.setFilter({ actor: event.currentTarget.value })}
        />
      </label>
      <label class="grid gap-1.5 text-sm">
        <span>Outcome</span>
        <Select
          size="sm"
          options={OUTCOMES.map((value) => ({ value, label: value === "" ? "any" : value }))}
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
                        <Icon name={ACTOR_ICON[row.actor.kind]} class="h-3.5 w-3.5 text-muted" />
                        {row.actor.label}
                      </span>
                    </Cell>
                    <Cell>
                      <code>{row.action}</code>
                    </Cell>
                    <Cell class="whitespace-nowrap">
                      <code class="text-xs text-muted">
                        {row.target_type} {row.target_id}
                      </code>
                    </Cell>
                    <Cell>{row.project?.slug ?? ""}</Cell>
                    <Cell>
                      <Badge
                        variant={row.outcome === null ? "secondary" : OUTCOME_VARIANT[row.outcome]}
                      >
                        {row.outcome ?? "n/a"}
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
