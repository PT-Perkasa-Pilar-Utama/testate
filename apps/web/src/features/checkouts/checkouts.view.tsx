import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createEffect, createSignal } from "solid-js";
import type { Checkout } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import Button from "@/components/button.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
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
import { CHECKOUT_PURPOSE_LABEL, JOB_STATUS_LABEL } from "@/lib/labels.ts";
import { subscribeJob } from "@/lib/sse.ts";
import { createPreflightPresenter } from "./preflight.presenter.ts";
import PreflightDialog from "./preflight.view.tsx";
import { statesModel } from "../states/states.model.ts";
import RecoveryActions from "./checkouts.actions.view.tsx";
import { CountersDialog, DetailDialog } from "./checkouts.dialogs.view.tsx";

/**
 * In the list, a database that restored is the expected case and reads plain; only a doubt or a
 * failure takes a colour. Four green pills per row made the one red one hard to find.
 */
import {
  CHECKOUT_PURPOSE_FILTER_OPTIONS,
  CHECKOUT_STATUS_FILTER_OPTIONS,
  adaptersSummary,
  createCheckoutsPresenter,
  outcomeLine,
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
  // Putting back is a checkout of the stash, through the same preflight as any other checkout.
  const preflight = createPreflightPresenter(
    () => props.slug,
    () => {
      presenter.refresh();
      props.onChanged?.();
    }
  );
  const undo = async (checkout: Checkout): Promise<void> => {
    const staticSlug = props.slug;
    const stash = checkout.stash_state_id;
    if (stash === null) return;
    presenter.close();
    await preflight.open(await statesModel.get(staticSlug, stash));
  };
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
                    <Cell class="whitespace-nowrap">
                      {/* One line, and the names behind it: a chip per database took half the
                          table, and what each one did is the Details dialog's first table. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Which databases, and what happened to each"
                        onClick={() => presenter.openDetail(checkout)}
                      >
                        {adaptersSummary(checkout)}
                      </Button>
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
                        <RecoveryActions
                          presenter={presenter}
                          checkout={checkout}
                          onUndo={(target) => void undo(target)}
                        />
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
        <DetailDialog presenter={presenter} onUndo={(target) => void undo(target)} />
        <CountersDialog presenter={presenter} />
        <PreflightDialog presenter={preflight} />
      </Loading>
    </div>
  );
}
