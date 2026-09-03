import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Switch from "@/components/switch.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { engineLabel } from "@/lib/labels.ts";
import { driftSummary, strategyLine } from "./preflight.presenter.ts";
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
        {props.adapter.name} <span class="text-muted">({engineLabel(props.adapter.engine)})</span>
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
    </Row>
  );
}

/**
 * How each database is put back, folded away. Stories 82 and 84 promise the strategy and the
 * locking behaviour before the confirm; most checkouts do not need them read, so they open on
 * request instead of taking a column of the table.
 */
function Strategies(props: { adapters: PreflightAdapter[] }): JSX.Element {
  return (
    <details class="rounded-lg ring ring-line">
      <summary class="cursor-pointer px-3 py-2 text-sm text-muted">
        How each database is restored
      </summary>
      <ul class="grid gap-2 px-3 pb-3 text-sm">
        <For each={props.adapters}>
          {(adapter) => (
            <li>
              <span class="font-medium">{adapter.name}</span>: {strategyLine(adapter)}
              <p class="text-muted">{adapter.locking_notice}</p>
            </li>
          )}
        </For>
      </ul>
    </details>
  );
}

export default function PreflightDialog(props: { presenter: PreflightPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.confirm();
  };
  return (
    <Dialog
      open={props.presenter.target() !== null}
      onClose={props.presenter.close}
      title={`Check out ${props.presenter.target()?.name ?? ""}`}
      description="Testate restores every included database to this state's data."
      size="lg"
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
              <Table>
                <thead>
                  <tr>
                    <Head>Database</Head>
                    <Head>Schema</Head>
                  </tr>
                </thead>
                <tbody>
                  <For each={preflight().adapters}>
                    {(adapter) => <AdapterRow adapter={adapter} force={props.presenter.force()} />}
                  </For>
                </tbody>
              </Table>
              <Strategies adapters={preflight().adapters} />
            </>
          )}
        </Show>
        {/*
          Force is the way past drift, so its box carries what it will and will not restore every
          time, and picks up a warning ring exactly when that is the thing standing in the way. The
          old copy sat in a banner above the table, disconnected from the switch that resolves it.
        */}
        <div
          class={[
            "grid gap-2 rounded-lg p-3 ring",
            props.presenter.blocked() ? "ring-warning/40" : "ring-line",
          ]}
        >
          <Switch
            label="Force: restore what both sides share"
            checked={props.presenter.force()}
            disabled={props.presenter.busy()}
            onChange={(next) => void props.presenter.setForce(next)}
          />
          <p class="text-sm text-muted">
            Force restores only the tables and columns that exist in both this state and the live
            database. Anything on just one side is skipped and listed after the restore, never
            restored or deleted.
          </p>
        </div>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Show when={!props.presenter.busy() && props.presenter.blocked()} fallback={<span />}>
            <p class="text-sm text-warning-fg">
              Schema drift is blocking this checkout. Turn on Force above to continue.
            </p>
          </Show>
          <div class="ml-auto flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!props.presenter.ready()}>
              Check out
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
