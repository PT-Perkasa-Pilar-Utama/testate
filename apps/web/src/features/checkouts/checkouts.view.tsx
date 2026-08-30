import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createEffect } from "solid-js";
import type { Checkout } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import LoadMore from "@/components/load-more.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { subscribeJob } from "@/lib/sse.ts";
import { CountersDialog, DetailDialog, RESULT_VARIANT } from "./checkouts.dialogs.view.tsx";
import { createCheckoutsPresenter, retriable } from "./checkouts.presenter.ts";

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

export default function CheckoutsView(props: {
  slug: string;
  onChanged?: () => void;
}): JSX.Element {
  const presenter = createCheckoutsPresenter(
    () => props.slug,
    () => props.onChanged?.()
  );
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading checkouts...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>State</Head>
            <Head>Purpose</Head>
            <Head>Status</Head>
            <Head>Adapters</Head>
            <Head>By</Head>
            <Head>Started</Head>
            <Head>Actions</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(checkout) => (
              <Row>
                <Follow checkout={checkout} onDone={() => presenter.refresh()} />
                <Cell>{checkout.state.name}</Cell>
                <Cell>{checkout.purpose}</Cell>
                <Cell>
                  <Badge variant={STATUS_VARIANT[checkout.status]}>{checkout.status}</Badge>
                </Cell>
                <Cell>
                  <span class="inline-flex flex-wrap gap-1">
                    <For each={checkout.adapters}>
                      {(adapter) => (
                        <Badge variant={RESULT_VARIANT[adapter.result]}>
                          {adapter.name}: {adapter.result}
                        </Badge>
                      )}
                    </For>
                  </span>
                </Cell>
                <Cell>{checkout.actor.label}</Cell>
                <Cell>{formatWhen(checkout.created_at)}</Cell>
                <Cell>
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
                    <Show when={hasRole("qa")}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!retriable(checkout)}
                        onClick={() => void presenter.retry(checkout)}
                      >
                        Retry
                      </Button>
                    </Show>
                  </div>
                </Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
      <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
      <DetailDialog presenter={presenter} />
      <CountersDialog presenter={presenter} />
    </Loading>
  );
}
