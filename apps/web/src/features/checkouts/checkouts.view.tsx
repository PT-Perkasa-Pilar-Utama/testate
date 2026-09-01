import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createEffect } from "solid-js";
import type { Checkout } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import LoadMore from "@/components/load-more.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  SortColumn,
  Table,
  TableFooter,
  TableSearch,
  TableToolbar,
  Truncated,
} from "@/components/table.tsx";
import { CHECKOUT_PURPOSE_LABEL, CHECKOUT_RESULT_LABEL, JOB_STATUS_LABEL } from "@/lib/labels.ts";
import { hasRole } from "@/lib/session.ts";
import { subscribeJob } from "@/lib/sse.ts";
import { CountersDialog, DetailDialog, RESULT_VARIANT } from "./checkouts.dialogs.view.tsx";
import {
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
            variant="destructive"
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

export default function CheckoutsView(props: {
  slug: string;
  onChanged?: () => void;
}): JSX.Element {
  const presenter = createCheckoutsPresenter(
    () => props.slug,
    () => props.onChanged?.()
  );
  return (
    <Loading fallback={<p class="text-muted">Loading checkouts...</p>}>
      <TableToolbar>
        <TableSearch
          placeholder="Search restores..."
          value={presenter.table.query()}
          onInput={(value) => presenter.table.setQuery(value)}
        />
      </TableToolbar>
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
                  when={presenter.value().length > 0}
                  fallback="No restores yet. This tab is the record of past restores and the place to retry a failed one. To start a restore, open the States tab and press Check out on a state."
                >
                  No restore matches that search.
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
                    <span class="inline-flex flex-wrap gap-1">
                      <For each={checkout.adapters}>
                        {(adapter) => (
                          <Badge variant={RESULT_VARIANT[adapter.result]}>
                            <span class="block max-w-[8rem] truncate" title={adapter.name}>
                              {adapter.name}
                            </span>
                            <span class="shrink-0">: {CHECKOUT_RESULT_LABEL[adapter.result]}</span>
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
                    <div class="flex flex-wrap justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => presenter.openDetail(checkout)}
                      >
                        Details
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
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
  );
}
