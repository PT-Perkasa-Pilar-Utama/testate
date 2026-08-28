import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { canCancel, createJobsPresenter } from "./jobs.presenter.ts";

const STATUS_VARIANT = {
  queued: "secondary",
  running: "info",
  succeeded: "success",
  partial: "warning",
  failed: "error",
  cancelled: "secondary",
  interrupted: "warning",
} as const;

export default function JobsView(): JSX.Element {
  const presenter = createJobsPresenter();
  return (
    <section class="grid gap-6">
      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-1.5">
          <h2 class="text-lg font-semibold">Jobs</h2>
          <p class="text-kumo-subtle">Snapshots, checkouts, diffs, imports, and maintenance.</p>
        </div>
        <Button variant="secondary" onClick={() => presenter.refresh()}>
          Refresh
        </Button>
      </div>
      <Loading fallback={<p class="text-kumo-subtle">Loading jobs...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Kind</Head>
              <Head>Status</Head>
              <Head>Queue</Head>
              <Head>By</Head>
              <Head>Created</Head>
              <Head />
            </tr>
          </thead>
          <tbody>
            <For each={presenter.value()}>
              {(job) => (
                <Row>
                  <Cell>{job.kind}</Cell>
                  <Cell>
                    <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
                  </Cell>
                  <Cell>{job.queue_position ?? ""}</Cell>
                  <Cell>{job.actor.label}</Cell>
                  <Cell>{job.created_at}</Cell>
                  <Cell>
                    <Show when={hasRole("qa") && canCancel(job)}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void presenter.cancel(job.id)}
                      >
                        Cancel
                      </Button>
                    </Show>
                  </Cell>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
      </Loading>
    </section>
  );
}
