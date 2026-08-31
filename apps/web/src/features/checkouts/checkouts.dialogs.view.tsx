import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { blockingSessions, countersSummary, skippedSummary } from "./checkouts.presenter.ts";
import type { CheckoutsPresenter } from "./checkouts.presenter.ts";

export const RESULT_VARIANT = {
  pending: "info",
  restored: "success",
  skipped: "secondary",
  rolled_back: "error",
  unknown: "warning",
  counters_failed: "warning",
} as const;

/** Per-adapter outcome of one checkout: result, strategy, rows, timing, and what was left out (story 80). */
export function DetailDialog(props: { presenter: CheckoutsPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.detail()}>
      {(checkout) => (
        <Dialog
          open
          onClose={() => props.presenter.close()}
          title={`Checkout of ${checkout().state.name}`}
          description={`${checkout().purpose} · ${checkout().status} · by ${checkout().actor.label}`}
          size="xl"
        >
          <div class="grid gap-4">
            <Table>
              <thead>
                <tr>
                  <Head>Adapter</Head>
                  <Head>Result</Head>
                  <Head>Strategy</Head>
                  <Head>Rows</Head>
                  <Head>Duration</Head>
                  <Head>Lock wait</Head>
                </tr>
              </thead>
              <tbody>
                <For each={checkout().adapters}>
                  {(adapter) => (
                    <Row>
                      <Cell>
                        {adapter.name} <span class="text-muted">({adapter.engine})</span>
                      </Cell>
                      <Cell>
                        <Badge variant={RESULT_VARIANT[adapter.result]}>{adapter.result}</Badge>
                        <Show when={skippedSummary(adapter) !== ""}>
                          <p class="text-muted text-sm">{skippedSummary(adapter)}</p>
                        </Show>
                        <Show when={adapter.error}>
                          {(error) => <p class="text-danger-fg text-sm">{error().message}</p>}
                        </Show>
                        <Show when={hasRole("qa") && blockingSessions(adapter).length > 0}>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void props.presenter.terminate(checkout(), adapter)}
                          >
                            Terminate blockers ({blockingSessions(adapter).join(", ")})
                          </Button>
                        </Show>
                      </Cell>
                      <Cell>
                        {adapter.strategy === null
                          ? "-"
                          : `${adapter.strategy.emptyMode} · ${adapter.strategy.foreignKeyHandling} FKs`}
                      </Cell>
                      <Cell>{adapter.rows ?? "-"}</Cell>
                      <Cell>
                        {adapter.duration_ms === null ? "-" : `${adapter.duration_ms} ms`}
                      </Cell>
                      <Cell>
                        {adapter.lock_wait_ms === null ? "-" : `${adapter.lock_wait_ms} ms`}
                      </Cell>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
            <div class="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Show>
  );
}

/** The counters step per adapter with a repair action for qa (story 81). */
export function CountersDialog(props: { presenter: CheckoutsPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.counters()}>
      {(target) => (
        <Dialog
          open
          onClose={() => props.presenter.close()}
          title={`Counters after ${target().checkout.state.name}`}
          description="Sequences and auto-increment counters reset after the rows are restored."
          size="lg"
        >
          <div class="grid gap-4">
            <Banner
              variant={countersSummary(target().result).endsWith("0 failed") ? "default" : "alert"}
            >
              {countersSummary(target().result)}
            </Banner>
            <For each={target().result.adapters}>
              {(adapter) => (
                <section class="grid gap-1">
                  <h3 class="font-medium">
                    {target().checkout.adapters.find((a) => a.adapter_id === adapter.adapter_id)
                      ?.name ?? adapter.adapter_id}
                  </h3>
                  <ul class="grid gap-1 text-sm">
                    <For each={adapter.counters}>
                      {(counter) => (
                        <li class="flex items-center gap-2">
                          <Badge variant={counter.ok ? "success" : "error"}>
                            {counter.ok ? "ok" : "failed"}
                          </Badge>
                          <code>{counter.name}</code>
                          <Show when={counter.error}>
                            {(message) => <span class="text-muted">{message()}</span>}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                Close
              </Button>
              <Show when={hasRole("qa")}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void props.presenter.repair()}
                >
                  Repair counters
                </Button>
              </Show>
            </div>
          </div>
        </Dialog>
      )}
    </Show>
  );
}
