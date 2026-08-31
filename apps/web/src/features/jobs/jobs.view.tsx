import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import type { Job } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import {
  canCancel,
  createJobsPresenter,
  createLiveJob,
  describeProgress,
} from "./jobs.presenter.ts";
import type { JobsPresenter } from "./jobs.presenter.ts";

const STATUS_VARIANT = {
  queued: "secondary",
  running: "info",
  succeeded: "success",
  partial: "warning",
  failed: "error",
  cancelled: "secondary",
  interrupted: "warning",
} as const;

/** One row; non-terminal jobs follow their event stream and refresh the list when they finish. */
function JobRow(props: { presenter: JobsPresenter; job: Job }): JSX.Element {
  const live = createLiveJob(
    () => props.job,
    () => props.presenter.refresh()
  );
  return (
    <Row>
      <Cell>{props.job.kind}</Cell>
      <Cell>
        <Badge variant={STATUS_VARIANT[live.status()]}>{live.status()}</Badge>
      </Cell>
      <Cell>
        <Show
          when={props.job.queue_position !== null}
          fallback={<span class="text-muted text-xs">{describeProgress(live.progress())}</span>}
        >
          queue #{props.job.queue_position}
        </Show>
      </Cell>
      <Cell>
        <Show when={props.job.error}>
          {(error) => <code class="text-danger-fg text-xs">{error().code}</code>}
        </Show>
      </Cell>
      <Cell class="whitespace-nowrap">{props.job.actor.label}</Cell>
      <Cell class="whitespace-nowrap">{formatWhen(props.job.created_at)}</Cell>
      <Cell pinned>
        <Show when={hasRole("qa") && canCancel(props.job)}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void props.presenter.cancel(props.job.id)}
          >
            Cancel
          </Button>
        </Show>
      </Cell>
    </Row>
  );
}

export default function JobsView(): JSX.Element {
  const presenter = createJobsPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Jobs"
        description="Snapshots, checkouts, diffs, imports, deletions, and maintenance. Running jobs update live."
        actions={
          <Button size="sm" variant="secondary" onClick={() => presenter.refresh()}>
            Refresh
          </Button>
        }
      />
      <Loading fallback={<p class="text-muted">Loading jobs...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Kind</Head>
              <Head>Status</Head>
              <Head>Progress</Head>
              <Head>Error</Head>
              <Head>By</Head>
              <Head>Created</Head>
              <Head pinned />
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No jobs yet. Snapshots, checkouts, diffs and imports all run as jobs and show up
                  here.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(job) => <JobRow presenter={presenter} job={job} />}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
    </section>
  );
}
