import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import type { Job } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
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
          fallback={
            <span class="text-kumo-subtle text-xs">{describeProgress(live.progress())}</span>
          }
        >
          queue #{props.job.queue_position}
        </Show>
      </Cell>
      <Cell>
        <Show when={props.job.error}>
          {(error) => <code class="text-kumo-danger text-xs">{error().code}</code>}
        </Show>
      </Cell>
      <Cell>{props.job.actor.label}</Cell>
      <Cell>{formatWhen(props.job.created_at)}</Cell>
      <Cell>
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
      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-1.5">
          <h2 class="text-lg font-semibold">Jobs</h2>
          <p class="text-kumo-subtle">
            Snapshots, checkouts, diffs, imports, deletions, and maintenance. Running jobs update
            live.
          </p>
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
              <Head>Progress</Head>
              <Head>Error</Head>
              <Head>By</Head>
              <Head>Created</Head>
              <Head />
            </tr>
          </thead>
          <tbody>
            <For each={presenter.value()}>
              {(job) => <JobRow presenter={presenter} job={job} />}
            </For>
          </tbody>
        </Table>
      </Loading>
    </section>
  );
}
