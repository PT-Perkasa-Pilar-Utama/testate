import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import {
  CHECKOUT_PURPOSE_LABEL,
  CHECKOUT_RESULT_LABEL,
  EMPTY_MODE_LABEL,
  FK_HANDLING_LABEL,
  JOB_STATUS_LABEL,
  engineLabel,
} from "@/lib/labels.ts";
import { hasRole } from "@/lib/session.ts";
import {
  blockingSessions,
  countersSummary,
  hasFailure,
  skippedSummary,
} from "./checkouts.presenter.ts";
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
  const checkout = (): ReturnType<CheckoutsPresenter["detail"]> => props.presenter.detail();
  /** The description line, kept out of the JSX attribute so narrowing `checkout()` works once. */
  const describe = (): string => {
    const loaded = checkout();
    if (loaded === null) return "";
    return `${CHECKOUT_PURPOSE_LABEL[loaded.purpose]} · ${JOB_STATUS_LABEL[loaded.status]} · by ${loaded.actor.label}`;
  };
  return (
    <Dialog
      open={checkout() !== null}
      onClose={props.presenter.close}
      title={`Checkout of ${checkout()?.state.name ?? ""}`}
      description={describe()}
      size="xl"
    >
      <Show when={checkout()}>
        {(loaded) => (
          <div class="grid gap-4">
            <Table>
              <thead>
                <tr>
                  <Head>Database</Head>
                  <Head>Result</Head>
                  <Head>Strategy</Head>
                  <Head>Rows</Head>
                  <Head>Duration</Head>
                  <Head>Lock wait</Head>
                </tr>
              </thead>
              <tbody>
                <For each={loaded().adapters}>
                  {(adapter) => (
                    <Row>
                      <Cell>
                        {adapter.name}{" "}
                        <span class="text-muted">({engineLabel(adapter.engine)})</span>
                      </Cell>
                      <Cell>
                        <Badge variant={RESULT_VARIANT[adapter.result]}>
                          {CHECKOUT_RESULT_LABEL[adapter.result]}
                        </Badge>
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
                            onClick={() => void props.presenter.terminate(loaded(), adapter)}
                          >
                            Terminate blockers ({blockingSessions(adapter).join(", ")})
                          </Button>
                        </Show>
                      </Cell>
                      <Cell>
                        {adapter.strategy === null
                          ? "-"
                          : `${EMPTY_MODE_LABEL[adapter.strategy.emptyMode]} · ${FK_HANDLING_LABEL[adapter.strategy.foreignKeyHandling]}`}
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
        )}
      </Show>
    </Dialog>
  );
}

/** The counters step per adapter with a repair action for qa (story 81). */
export function CountersDialog(props: { presenter: CheckoutsPresenter }): JSX.Element {
  const target = (): ReturnType<CheckoutsPresenter["counters"]> => props.presenter.counters();
  return (
    <Dialog
      open={target() !== null}
      onClose={props.presenter.close}
      title={`Counters after ${target()?.checkout.state.name ?? ""}`}
      description="Sequences and auto-increment counters reset after the rows are restored."
      size="lg"
    >
      <Show when={target()}>
        {(loaded) => (
          <div class="grid gap-4">
            <Banner variant={hasFailure(loaded().result) ? "alert" : "default"}>
              {countersSummary(loaded().result)}
            </Banner>
            <For each={loaded().result.adapters}>
              {(adapter) => (
                <section class="grid gap-1">
                  <h3 class="font-medium">
                    {loaded().checkout.adapters.find((a) => a.adapter_id === adapter.adapter_id)
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
            <DialogActions>
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
            </DialogActions>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
