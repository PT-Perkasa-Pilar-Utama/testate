import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createEffect, createSignal } from "solid-js";
import type { Checkout } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import Button from "@/components/button.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
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
import { CHECKOUT_PURPOSE_LABEL, CHECKOUT_RESULT_LABEL, JOB_STATUS_LABEL } from "@/lib/labels.ts";
import { hasRole } from "@/lib/session.ts";
import { subscribeJob } from "@/lib/sse.ts";
import { CountersDialog, DetailDialog, RESULT_VARIANT } from "./checkouts.dialogs.view.tsx";

/**
 * In the list, a database that restored is the expected case and reads plain; only a doubt or a
 * failure takes a colour. Four green pills per row made the one red one hard to find.
 */
const ROW_RESULT_VARIANT = {
  ...RESULT_VARIANT,
  restored: "outline",
  skipped: "outline",
} as const;
import {
  CHECKOUT_PURPOSE_FILTER_OPTIONS,
  CHECKOUT_STATUS_FILTER_OPTIONS,
  blockedAdapters,
  createCheckoutsPresenter,
  outcomeLine,
  retriable,
  retryBlockedReason,
} from "./checkouts.presenter.ts";
import type { CheckoutsPresenter } from "./checkouts.presenter.ts";

const STATUS_VARIANT = {
  running: "info",
  succeeded: "success",
  partial: "warning",
  failed: "error",
  cancelled: "secondary",
  interrupted: "warning",
} as const;

/** A running checkout follows its job over SSE and reloads the history when it ends (story 87). */
function Follow(props: { checkout: Checkout; onDone: () => void }): null {
  createEffect(
    () => (props.checkout.status === "running" ? props.checkout.job_id : null),
    (jobId) => {
      if (jobId === null) return undefined;
      return subscribeJob(jobId, (event) => {
        if (event.kind === "status" && TERMINAL_JOB_STATUSES.includes(event.job.status))
          props.onDone();
      });
    }
  );
  return null;
}

/** What happened: the status a person reads, plus the one line a failed or partial run left behind. */
function Outcome(props: { checkout: Checkout }): JSX.Element {
  return (
    <div class="grid gap-1">
      <Badge variant={STATUS_VARIANT[props.checkout.status]}>
        {JOB_STATUS_LABEL[props.checkout.status]}
      </Badge>
      <Show when={outcomeLine(props.checkout) !== ""}>
        <p class="text-muted text-xs">{outcomeLine(props.checkout)}</p>
      </Show>
    </div>
  );
}

/**
 * The three recovery actions this screen exists for. Terminate blockers used to live only inside
 * the Details dialog, one adapter at a time; a failed restore now clears it from the row it landed
 * on, and the dialog keeps its own copy for the moment someone is already in there reading why.
 */
function RecoveryActions(props: {
  presenter: CheckoutsPresenter;
  checkout: Checkout;
}): JSX.Element {
  return (
    <Show when={hasRole("qa")}>
      <Button
        size="sm"
        variant="secondary"
        disabled={!retriable(props.checkout)}
        title={retryBlockedReason(props.checkout)}
        onClick={() => void props.presenter.retry(props.checkout)}
      >
        Retry
      </Button>
      <For each={blockedAdapters(props.checkout)}>
        {(adapter) => (
          <Button
            size="sm"
            variant="danger"
            onClick={() => void props.presenter.terminate(props.checkout, adapter)}
          >
            <Icon name="ban" class="h-3 w-3" />
            Terminate blockers
          </Button>
        )}
      </For>
    </Show>
  );
}

/** Search text or a picked filter narrows the list; an empty result under either reads as "no
 *  matches", not as "no restores yet". */
function isFiltered(presenter: CheckoutsPresenter): boolean {
  return (
    presenter.table.query() !== "" ||
    presenter.filters().status !== "" ||
    presenter.filters().purpose !== "" ||
    presenter.table.createdFrom() !== "" ||
    presenter.table.createdTo() !== ""
  );
}

/** The panel's own fields only; the search box's own text is already visible without opening it. */
function activeCount(presenter: CheckoutsPresenter): number {
  return activeFilterCount(
    presenter.filters().status !== "",
    presenter.filters().purpose !== "",
    presenter.table.createdFrom() !== "" || presenter.table.createdTo() !== ""
  );
}

export default function CheckoutsView(props: {
  slug: string;
  onChanged?: () => void;
}): JSX.Element {
  const presenter = createCheckoutsPresenter(
    () => props.slug,
    () => props.onChanged?.()
  );
  const [open, setOpen] = createSignal(false);
  return (
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <TableSearch
          placeholder="Search restores..."
          value={presenter.table.query()}
          onInput={(value) => presenter.table.setQuery(value)}
        />
        <FilterToggle
          open={open()}
          active={activeCount(presenter)}
          onToggle={() => setOpen((value) => !value)}
        />
      </div>
      <FilterPanel open={open()}>
        <FilterField label="Status">
          <Select
            options={CHECKOUT_STATUS_FILTER_OPTIONS}
            value={presenter.filters().status}
            onChange={(value) => presenter.setFilters({ status: value })}
          />
        </FilterField>
        <FilterField label="Purpose">
          <Select
            options={CHECKOUT_PURPOSE_FILTER_OPTIONS}
            value={presenter.filters().purpose}
            onChange={(value) => presenter.setFilters({ purpose: value })}
          />
        </FilterField>
        <FilterField label="Started from">
          <Input
            type="date"
            value={presenter.table.createdFrom()}
            onInput={(event) => presenter.table.setCreatedFrom(event.currentTarget.value)}
          />
        </FilterField>
        <FilterField label="Started to">
          <Input
            type="date"
            value={presenter.table.createdTo()}
            onInput={(event) => presenter.table.setCreatedTo(event.currentTarget.value)}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<Pending>Loading checkouts...</Pending>}>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="state">
                Restore
              </SortColumn>
              <SortColumn view={presenter.table} column="status">
                Result
              </SortColumn>
              <Head>Databases</Head>
              <SortColumn view={presenter.table} column="actor">
                By
              </SortColumn>
              <SortColumn view={presenter.table} column="created_at">
                Started
              </SortColumn>
              <Head pinned>Actions</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.table.rows().length > 0}
              fallback={
                <EmptyRow>
                  <Show
                    when={isFiltered(presenter)}
                    fallback="No restores yet. This tab is the record of past restores and the place to retry a failed one. Open the States tab and press Check out on a state to start one."
                  >
                    No restore matches your search or filters.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(checkout) => (
                  <Row>
                    <Follow checkout={checkout} onDone={() => presenter.refresh()} />
                    <Cell>
                      <div class="grid gap-0.5">
                        <Truncated class="max-w-[18rem] font-medium text-heading">
                          {checkout.state.name}
                        </Truncated>
                        <span class="text-muted text-xs">
                          {CHECKOUT_PURPOSE_LABEL[checkout.purpose]}
                        </span>
                      </div>
                    </Cell>
                    <Cell wrap>
                      <Outcome checkout={checkout} />
                    </Cell>
                    <Cell>
                      <span class="inline-flex max-w-[22rem] flex-wrap gap-1">
                        <For each={checkout.adapters}>
                          {(adapter) => (
                            <Badge variant={ROW_RESULT_VARIANT[adapter.result]}>
                              <span class="block max-w-[8rem] truncate" title={adapter.name}>
                                {adapter.name}
                              </span>
                              <span class="shrink-0">
                                : {CHECKOUT_RESULT_LABEL[adapter.result]}
                              </span>
                            </Badge>
                          )}
                        </For>
                      </span>
                    </Cell>
                    <Cell class="whitespace-nowrap">
                      <Truncated class="max-w-[10rem]">{checkout.actor.label}</Truncated>
                    </Cell>
                    <Cell class="whitespace-nowrap">{formatWhen(checkout.created_at)}</Cell>
                    <Cell pinned>
                      <div class="flex justify-end gap-1 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => presenter.openDetail(checkout)}
                        >
                          Details
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void presenter.openCounters(checkout)}
                        >
                          Counters
                        </Button>
                        <RecoveryActions presenter={presenter} checkout={checkout} />
                      </div>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter
          shown={presenter.table.rows().length}
          noun="checkouts"
          hasMore={presenter.hasMore()}
          total={presenter.total()}
        >
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
        <DetailDialog presenter={presenter} />
        <CountersDialog presenter={presenter} />
      </Loading>
    </div>
  );
}
