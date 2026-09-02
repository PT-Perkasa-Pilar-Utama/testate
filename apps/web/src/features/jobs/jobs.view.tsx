import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createSignal } from "solid-js";
import type { Job, JobStatus, JsonObject } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Meter from "@/components/meter.tsx";
import LoadMore from "@/components/load-more.tsx";
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
  Truncated,
} from "@/components/table.tsx";
import { activeFilterCount } from "@/lib/table.ts";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL } from "@/lib/labels.ts";
import { hasRole } from "@/lib/session.ts";
import {
  JOB_KIND_FILTER_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
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
function ProgressCell(props: { progress: JsonObject | null; status: JobStatus }): JSX.Element {
  // A job that succeeded is all the way there whatever its last event said. A restore reports
  // "2 of 3 tables" and then finishes without a final count, so the list showed 67% next to
  // "Succeeded" for good.
  const ratio = (): number | null =>
    props.status === "succeeded" ? 1 : progressFraction(props.progress);
  return (
    <Show
      when={ratio() !== null}
      fallback={<span class="text-xs text-muted">{describeProgress(props.progress)}</span>}
    >
      <div class="w-44">
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
        <Badge variant={STATUS_VARIANT[live.status()]}>{JOB_STATUS_LABEL[live.status()]}</Badge>
      </Cell>
      <Cell>
        <Show
          when={props.job.queue_position !== null}
          fallback={<ProgressCell progress={live.progress()} status={live.status()} />}
        >
          queue #{props.job.queue_position}
        </Show>
      </Cell>
      <Cell class="max-w-64">
        {/* error.message is a free-text failure string with no cap; the cell keeps its own
            16rem max-width, the span only needs to turn that into an ellipsis instead of an
            overflow. The code stays in the tooltip since it's the detail the message itself
            doesn't repeat. */}
        <Show when={props.job.error}>
          {(error) => (
            <span
              class="block truncate text-xs text-danger-fg"
              title={`${error().message} (${error().code})`}
            >
              {error().message}
            </span>
          )}
        </Show>
      </Cell>
      <Cell class="whitespace-nowrap">
        {/* Same actor.label as the audit log: a username caps at 64, but a token's own name has
            no cap. */}
        <Truncated class="max-w-[12rem]">{props.job.actor.label}</Truncated>
      </Cell>
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

/** Search text or a picked filter narrows the list; an empty result under either reads as "no
 *  matches", not as "no jobs yet". */
function isFiltered(presenter: JobsPresenter): boolean {
  return (
    presenter.table.query() !== "" ||
    presenter.filters().kind !== "" ||
    presenter.filters().status !== "" ||
    presenter.table.createdFrom() !== "" ||
    presenter.table.createdTo() !== ""
  );
}

/** The panel's own fields only; the search box's own text is already visible without opening it. */
function activeCount(presenter: JobsPresenter): number {
  return activeFilterCount(
    presenter.filters().kind !== "",
    presenter.filters().status !== "",
    presenter.table.createdFrom() !== "" || presenter.table.createdTo() !== ""
  );
}

export default function JobsView(): JSX.Element {
  const presenter = createJobsPresenter();
  const [open, setOpen] = createSignal(false);
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Jobs"
        description="Snapshots, checkouts, comparisons, imports, deletions, and maintenance. Running jobs update live."
        actions={
          <>
            <TableSearch
              placeholder="Search jobs..."
              value={presenter.table.query()}
              onInput={(value) => presenter.table.setQuery(value)}
            />
            <FilterToggle
              open={open()}
              active={activeCount(presenter)}
              onToggle={() => setOpen((value) => !value)}
            />
            <Button variant="secondary" onClick={() => presenter.refresh()}>
              Refresh
            </Button>
          </>
        }
      />
      <FilterPanel open={open()}>
        <FilterField label="Kind">
          <Select
            options={JOB_KIND_FILTER_OPTIONS}
            value={presenter.filters().kind}
            onChange={(value) => presenter.setFilters({ kind: value })}
          />
        </FilterField>
        <FilterField label="Status">
          <Select
            options={JOB_STATUS_FILTER_OPTIONS}
            value={presenter.filters().status}
            onChange={(value) => presenter.setFilters({ status: value })}
          />
        </FilterField>
        <FilterField label="Created from">
          <Input
            type="date"
            value={presenter.table.createdFrom()}
            onInput={(event) => presenter.table.setCreatedFrom(event.currentTarget.value)}
          />
        </FilterField>
        <FilterField label="Created to">
          <Input
            type="date"
            value={presenter.table.createdTo()}
            onInput={(event) => presenter.table.setCreatedTo(event.currentTarget.value)}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<p class="text-muted">Loading jobs...</p>}>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="kind">
                Kind
              </SortColumn>
              <SortColumn view={presenter.table} column="status">
                Status
              </SortColumn>
              <Head>Progress</Head>
              <Head>Error</Head>
              <SortColumn view={presenter.table} column="actor">
                By
              </SortColumn>
              <SortColumn view={presenter.table} column="created_at">
                Created
              </SortColumn>
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
                    fallback="No jobs yet. Snapshots, checkouts, comparisons and imports all run as jobs and show up here."
                  >
                    No job matches your search or filters.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(job) => <JobRow presenter={presenter} job={job} />}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter
          shown={presenter.table.rows().length}
          noun="jobs"
          hasMore={presenter.hasMore()}
          total={presenter.total()}
        >
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
    </section>
  );
}
