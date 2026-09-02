import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import type { Diff } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuItem, MenuLink } from "@/components/menu.tsx";
import { Cell, EmptyRow, Head, Row, SortColumn, Table, TableSearch } from "@/components/table.tsx";
import { DIFF_STATUS_LABEL } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import {
  changedRows,
  createDiffsPresenter,
  detailBlockedReason,
  diffTotals,
  targetLabel,
} from "./diffs.presenter.ts";
import type { DiffsPresenter } from "./diffs.presenter.ts";

const STATUS_VARIANT = { running: "info", ready: "success", failed: "error" } as const;

/**
 * Base and target on one line, the way a compare view names the two sides of a diff. A state name
 * caps at 80 characters with no restriction on spaces, so each side gets its own bound: 12rem is
 * the same width `projects.view.tsx` gives a state name in the "at_state" badge, for the same cap.
 */
function CompareCell(props: { diff: Diff }): JSX.Element {
  return (
    <span class="inline-flex items-center gap-1.5">
      <Icon name="git-compare" class="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      <span class="max-w-[12rem] truncate font-medium text-heading" title={props.diff.base.name}>
        {props.diff.base.name}
      </span>
      <span class="text-muted" aria-hidden="true">
        →
      </span>
      <span class="max-w-[12rem] truncate" title={targetLabel(props.diff.target)}>
        {targetLabel(props.diff.target)}
      </span>
    </span>
  );
}

/** Details is the reason to be on this screen; export and delete are the row's overflow. */
function DiffRow(props: { presenter: DiffsPresenter; diff: Diff; slug: string }): JSX.Element {
  const totals = () => diffTotals(props.diff);
  const hasMenu = (): boolean => props.diff.status === "ready" || hasRole("qa");
  return (
    <Row>
      <Cell>
        <CompareCell diff={props.diff} />
      </Cell>
      <Cell>
        <Badge variant={STATUS_VARIANT[props.diff.status]}>
          {DIFF_STATUS_LABEL[props.diff.status]}
        </Badge>
      </Cell>
      <Cell
        numeric
        title={`${totals().added} added, ${totals().removed} removed, ${totals().changed} changed`}
      >
        {changedRows(props.diff)}
      </Cell>
      <Cell>{formatWhen(props.diff.expires_at)}</Cell>
      <Cell pinned>
        <div class="flex items-center justify-end gap-1">
          {/* A page, not a dialog: a comparison is wide and has two of everything
              (docs/PROJECT_REWORK.md). */}
          <Show
            when={props.diff.status === "ready"}
            fallback={
              <Button size="sm" variant="primary" disabled title={detailBlockedReason(props.diff)}>
                Details
              </Button>
            }
          >
            <a
              class={buttonClass("primary", "sm")}
              href={href(`/projects/${props.slug}/diffs/${props.diff.id}`)}
            >
              Details
            </a>
          </Show>
          <Show when={hasMenu()}>
            <Menu label={`More actions for ${props.diff.base.name} comparison`}>
              <Show when={props.diff.status === "ready"}>
                <MenuLink href={props.presenter.exportUrl(props.diff, "csv")}>Export CSV</MenuLink>
                <MenuLink href={props.presenter.exportUrl(props.diff, "jsonl")}>
                  Export JSON
                </MenuLink>
              </Show>
              <Show when={hasRole("qa")}>
                <MenuItem danger onClick={() => void props.presenter.remove(props.diff)}>
                  Delete
                </MenuItem>
              </Show>
            </Menu>
          </Show>
        </div>
      </Cell>
    </Row>
  );
}

export default function DiffsView(props: { slug: string; onChanged?: () => void }): JSX.Element {
  const presenter = createDiffsPresenter(
    () => props.slug,
    () => props.onChanged?.()
  );
  return (
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <TableSearch
          placeholder="Search diffs..."
          value={presenter.table.query()}
          onInput={(value) => presenter.table.setQuery(value)}
        />
        {/* No New diff here: a diff is two states, and the place to pick two states is the
            States tab, where ticking two offers Compare (docs/PROJECT_REWORK.md). */}
      </div>
      <Loading fallback={<Pending>Loading diffs...</Pending>}>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="base">
                Compare
              </SortColumn>
              <SortColumn view={presenter.table} column="status">
                Status
              </SortColumn>
              <SortColumn view={presenter.table} column="changed" numeric>
                Changed rows
              </SortColumn>
              <SortColumn view={presenter.table} column="expires_at">
                Expires
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
                    fallback="No diffs yet. Compare two states, or a state against what the databases hold now, to see what a test run changed."
                  >
                    No diff matches that search.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(diff) => <DiffRow presenter={presenter} diff={diff} slug={props.slug} />}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
    </div>
  );
}
