import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { createAuditPresenter } from "./audit.presenter.ts";

const OUTCOME_VARIANT = { succeeded: "success", failed: "error", partial: "warning" } as const;

export default function AuditView(): JSX.Element {
  const presenter = createAuditPresenter();
  return (
    <section class="grid gap-6">
      <div class="grid gap-1.5">
        <h2 class="text-lg font-semibold">Audit log</h2>
        <p class="text-kumo-subtle">Every write, by whom, and how it ended.</p>
      </div>
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
      </Loading>
    </section>
  );
}
