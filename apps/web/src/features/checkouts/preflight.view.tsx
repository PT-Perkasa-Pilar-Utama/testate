import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Switch from "@/components/switch.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { canCheckout, driftSummary, strategyLine } from "./preflight.presenter.ts";
import type { PreflightAdapter, PreflightPresenter } from "./preflight.presenter.ts";

function AdapterRow(props: { adapter: PreflightAdapter; force: boolean }): JSX.Element {
  const drift = (): string => driftSummary(props.adapter.drift);
  const preview = (): string => {
    const forced = props.adapter.force_preview;
    if (forced === undefined) return "";
    return `${forced.skipped_tables.length} tables and ${forced.skipped_columns.length} columns skipped, ${forced.defaulted_columns.length} defaulted`;
  };
  return (
    <Row>
      <Cell>
        {props.adapter.name} <span class="text-muted">({props.adapter.engine})</span>
      </Cell>
      <Cell>
        <Show when={!props.adapter.included}>
          <Badge variant="secondary">not in state</Badge>
        </Show>
        <Show when={props.adapter.removed}>
          <Badge variant="secondary">removed</Badge>
        </Show>
        <Show when={props.adapter.included && !props.adapter.removed}>
          <Show when={drift() === ""} fallback={<Badge variant="error">drift: {drift()}</Badge>}>
            <Badge variant="success">schema matches</Badge>
          </Show>
        </Show>
        <Show when={props.force && preview() !== ""}>
          <p class="text-muted text-sm">{preview()}</p>
        </Show>
      </Cell>
      <Cell>
        {strategyLine(props.adapter)}
        <p class="text-muted text-sm">{props.adapter.locking_notice}</p>
      </Cell>
    </Row>
  );
}

export default function PreflightDialog(props: { presenter: PreflightPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.confirm();
  };
  return (
    <Show when={props.presenter.target()}>
      {(state) => (
        <Dialog
          open
          onClose={() => props.presenter.close()}
          title={`Check out ${state().name}`}
          description="Testate restores every included adapter to this state's data."
          size="xl"
        >
          <form class="grid gap-4" onSubmit={onSubmit}>
            <Show when={props.presenter.preflight()} fallback={<p>Checking schemas...</p>}>
              {(preflight) => (
                <>
                  <Show when={preflight().stash_will_be_taken}>
                    <Banner variant="default">
                      A stash state is taken first, so this checkout is reversible.
                    </Banner>
                  </Show>
                  <Show when={!canCheckout(preflight(), props.presenter.force())}>
                    <Banner variant="alert">
                      The live schema drifted from this state. Turn on force to restore the tables
                      and columns present on both sides; the rest is reported.
                    </Banner>
                  </Show>
                  <Table>
                    <thead>
                      <tr>
                        <Head>Adapter</Head>
                        <Head>Schema</Head>
                        <Head>Restore</Head>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={preflight().adapters}>
                        {(adapter) => (
                          <AdapterRow adapter={adapter} force={props.presenter.force()} />
                        )}
                      </For>
                    </tbody>
                  </Table>
                </>
              )}
            </Show>
            <Switch
              label="Force: restore what both sides share"
              checked={props.presenter.force()}
              disabled={props.presenter.busy()}
              onChange={(next) => void props.presenter.setForce(next)}
            />
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!props.presenter.ready()}>
                Check out
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </Show>
  );
}
