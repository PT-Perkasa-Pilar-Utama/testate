import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Input from "@/components/input.tsx";
import LoadMore from "@/components/load-more.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { OUTCOMES, createAuditPresenter } from "./audit.presenter.ts";
import type { AuditPresenter } from "./audit.presenter.ts";

const OUTCOME_VARIANT = { succeeded: "success", failed: "error", partial: "warning" } as const;

/** The API has filtered by action, actor and outcome since it was written. This is the screen. */
function Filters(props: { presenter: AuditPresenter }): JSX.Element {
  return (
    <div class="flex flex-wrap items-end gap-2">
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
    </div>
  );
}

export default function AuditView(): JSX.Element {
  const presenter = createAuditPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader title="Audit log" description="Every write, by whom, and how it ended." />
      <Filters presenter={presenter} />
      <Loading fallback={<p class="text-kumo-subtle">Loading audit rows...</p>}>
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
                  Nothing in the audit log yet. Every login and every change lands here.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(row) => (
                  <Row>
                    <Cell>{formatWhen(row.created_at)}</Cell>
                    <Cell>{row.actor.label}</Cell>
                    <Cell>
                      <code>{row.action}</code>
                    </Cell>
                    <Cell>
                      {row.target_type} {row.target_id}
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
        <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
      </Loading>
    </section>
  );
}
