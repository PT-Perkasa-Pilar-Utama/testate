import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import type { Job, JsonObject } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import Meter from "@/components/meter.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import {
  JOB_KIND_LABEL,
  cancelable,
  createJobsPresenter,
  createLiveJob,
  describeProgress,
  progressFraction,
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

/**
 * A sentence for jobs with nothing to count (stashing, hooks), a meter for jobs that do. The bar
 * is the difference between reading a number and reading a shape at a glance.
 */
function ProgressCell(props: { progress: JsonObject | null }): JSX.Element {
  const ratio = (): number | null => progressFraction(props.progress);
  return (
    <Show
      when={ratio() !== null}
      fallback={<span class="text-xs text-muted">{describeProgress(props.progress)}</span>}
    >
      <div class="w-40">
        <Meter
          value={ratio() ?? 0}
          max={1}
          label={describeProgress(props.progress)}
          detail={`${Math.round((ratio() ?? 0) * 100)}%`}
        />
      </div>
    </Show>
  );
}

/** One row; non-terminal jobs follow their event stream and refresh the list when they finish. */
function JobRow(props: { presenter: JobsPresenter; job: Job }): JSX.Element {
  const live = createLiveJob(
    () => props.job,
    () => props.presenter.refresh()
  );
  // Keyed off the live status, not the row's initial prop, so Cancel disappears the instant the
  // stream says terminal rather than waiting on the list refresh that follows it.
  const showCancel = (): boolean =>
    hasRole("qa") && cancelable(live.status(), props.job.cancel_requested);
  return (
    <Row>
      <Cell>{JOB_KIND_LABEL[props.job.kind]}</Cell>
      <Cell>
        <Badge variant={STATUS_VARIANT[live.status()]}>{live.status()}</Badge>
      </Cell>
      <Cell>
        <Show
          when={props.job.queue_position !== null}
          fallback={<ProgressCell progress={live.progress()} />}
        >
          queue #{props.job.queue_position}
        </Show>
      </Cell>
      <Cell class="max-w-64">
        <Show when={props.job.error}>
          {(error) => (
            <span class="text-xs text-danger-fg" title={error().code}>
              {error().message}
            </span>
          )}
        </Show>
      </Cell>
      <Cell class="whitespace-nowrap">{props.job.actor.label}</Cell>
      <Cell class="whitespace-nowrap">{formatWhen(props.job.created_at)}</Cell>
      <Cell pinned>
        <Show when={showCancel()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void props.presenter.cancel(props.job.id)}
          >
            <Icon name="x" class="h-3.5 w-3.5" />
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
        description="Snapshots, checkouts, comparisons, imports, deletions, and maintenance. Running jobs update live."
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
                  No jobs yet. Snapshots, checkouts, comparisons and imports all run as jobs and
                  show up here.
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
