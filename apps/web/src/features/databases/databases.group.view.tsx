import type { JSX } from "@solidjs/web";
import type { AdapterWithProject } from "@testate/shared";
import { For, Show, untrack } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import InspectBadge from "@/components/inspect-badge.tsx";
import { Cell, EmptyRow, Head, Row, SortColumn, Table } from "@/components/table.tsx";
import { statusReason } from "@/lib/api-error.ts";
import {
  ADAPTER_MODE_LABEL,
  ADAPTER_STATUS_LABEL,
  ENGINE_LABEL,
  TIER_LABEL,
} from "@/lib/labels.ts";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { createPreflightPresenter } from "../checkouts/preflight.presenter.ts";
import PreflightDialog from "../checkouts/preflight.view.tsx";
import { STATUS_VARIANT } from "../adapters/adapters.fields.ts";
import { statesModel } from "../states/states.model.ts";
import type { DatabaseGroup, DatabasesPresenter } from "./databases.presenter.ts";

/**
 * Today's starting-point banner, for one project (Q2). It holds its own preflight, so checking out
 * one project's starting point never waits on which project's banner was pressed last.
 */
function StartingPointBanner(props: { slug: string; onChanged: () => void }): JSX.Element {
  const slug = untrack(() => props.slug);
  const preflight = createPreflightPresenter(
    () => slug,
    () => props.onChanged()
  );
  const toInit = async (): Promise<void> => {
    await preflight.open(await statesModel.get(slug, "init"));
  };
  return (
    <Banner variant="default">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span>
          A database can join this project only while every database holds its starting point. Check
          out the starting point first, then add it.
        </span>
        <Button size="sm" variant="accent-outline" onClick={() => void toInit()}>
          Check out the starting point
        </Button>
      </div>
      <PreflightDialog presenter={preflight} />
    </Banner>
  );
}

function DatabaseRow(props: { row: AdapterWithProject; inspect: boolean }): JSX.Element {
  const path = (): string => `/projects/${props.row.project_slug}/adapters/${props.row.id}`;
  return (
    <Row>
      <Cell>
        <a
          class="block max-w-[18rem] truncate text-info-fg hover:underline"
          title={props.row.name}
          href={href(path())}
          onClick={(event) => {
            event.preventDefault();
            navigate(path());
          }}
        >
          {props.row.name}
        </a>
      </Cell>
      <Cell>
        {ENGINE_LABEL[props.row.engine]}
        {props.row.engine_version === null ? "" : ` ${props.row.engine_version}`}
      </Cell>
      <Cell>
        <Badge variant="outline">{TIER_LABEL[props.row.tier]}</Badge>
      </Cell>
      <Cell>
        <Badge variant={props.row.mode === "read_only" ? "info" : "secondary"}>
          {ADAPTER_MODE_LABEL[props.row.mode]}
        </Badge>
      </Cell>
      <Cell>
        <Show when={props.row.credential.set} fallback={<span class="text-muted">none</span>}>
          <code>{props.row.credential.set ? props.row.credential.key_fingerprint : ""}</code>
        </Show>
      </Cell>
      <Cell wrap>
        <div class="grid gap-0.5">
          <Badge variant={STATUS_VARIANT[props.row.status]}>
            {ADAPTER_STATUS_LABEL[props.row.status]}
          </Badge>
          <Show when={props.row.status !== "ok"}>
            <span class="text-xs text-muted">
              {statusReason(props.row.status_message) ?? "No reason recorded."}
            </span>
          </Show>
        </div>
      </Cell>
      <Show when={props.inspect}>
        <Cell>{props.row.created_by_label ?? "an admin"}</Cell>
      </Show>
    </Row>
  );
}

/** One project's databases: its name, its banner when no database may join, and its table. */
export default function DatabaseGroupView(props: {
  group: DatabaseGroup;
  presenter: DatabasesPresenter;
}): JSX.Element {
  const table = (): DatabasesPresenter["table"] => props.presenter.table;
  return (
    <section class="grid gap-2">
      <h3 class="flex items-baseline gap-2 text-sm font-medium text-heading">
        {props.group.name}
        <Show when={props.group.inspect}>
          <InspectBadge />
        </Show>
        <span class="text-xs text-muted">{props.group.rows.length}</span>
      </h3>
      <Show when={hasRole("qa") && !props.group.atStart}>
        <StartingPointBanner
          slug={props.group.slug}
          onChanged={() => props.presenter.refreshAll()}
        />
      </Show>
      <Table>
        <thead>
          <tr>
            <SortColumn view={table()} column="name">
              Name
            </SortColumn>
            <SortColumn view={table()} column="engine">
              Engine
            </SortColumn>
            <SortColumn view={table()} column="tier">
              Tier
            </SortColumn>
            <SortColumn view={table()} column="mode">
              Mode
            </SortColumn>
            <Head>Credential</Head>
            <SortColumn view={table()} column="status">
              Status
            </SortColumn>
            <Show when={props.group.inspect}>
              <Head>Added by</Head>
            </Show>
          </tr>
        </thead>
        <tbody>
          <Show
            when={props.group.rows.length > 0}
            fallback={<EmptyRow>No databases in {props.group.name} match.</EmptyRow>}
          >
            <For each={props.group.rows}>
              {(row) => <DatabaseRow row={row} inspect={props.group.inspect} />}
            </For>
          </Show>
        </tbody>
      </Table>
    </section>
  );
}
