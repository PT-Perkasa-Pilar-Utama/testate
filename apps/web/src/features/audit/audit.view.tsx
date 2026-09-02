import type { JSX } from "@solidjs/web";
import type { AuditRow } from "@testate/shared";
import PageHeader from "@/components/page-header.tsx";
import Pending from "@/components/pending.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { AUDIT_OUTCOME_LABEL } from "@/lib/labels.ts";
import { activeFilterCount } from "@/lib/table.ts";
import { Cell, EmptyRow, Head, Row, Table, TableFooter, TableSearch } from "@/components/table.tsx";
import { OUTCOMES, createAuditPresenter } from "./audit.presenter.ts";
import type { AuditPresenter } from "./audit.presenter.ts";

const OUTCOME_VARIANT = { succeeded: "success", failed: "error", partial: "warning" } as const;
// Who acted, at a glance, without reading "user"/"token"/"system" on every row. Keyed to match
// `AuditRow["actor"]["kind"]` exactly, so indexing by it needs no cast.
const ACTOR_ICON = { user: "user", token: "key-round", system: "terminal" } as const;

function hasFilter(filter: AuditPresenter["filter"]): boolean {
  const current = filter();
  return (
    current.action !== "" ||
    current.actor !== "" ||
    current.outcome !== "" ||
    current.from !== "" ||
    current.to !== ""
  );
}

/** The panel's own fields only; a date range is two boxes but counts as the one filter it is. */
function activeCount(filter: AuditPresenter["filter"]): number {
  const current = filter();
  return activeFilterCount(
    current.action !== "",
    current.actor !== "",
    current.outcome !== "",
    current.from !== "" || current.to !== ""
  );
}

/** The API has filtered by action, actor, outcome and a created-date range since it was written. */
function Filters(props: { presenter: AuditPresenter }): JSX.Element {
  return (
    <>
      <FilterField label="Action">
        <Input
          placeholder="auth.login"
          value={props.presenter.filter().action}
          onInput={(event) => props.presenter.setFilter({ action: event.currentTarget.value })}
        />
      </FilterField>
      <FilterField label="Actor">
        <Input
          placeholder="qa-user"
          value={props.presenter.filter().actor}
          onInput={(event) => props.presenter.setFilter({ actor: event.currentTarget.value })}
        />
      </FilterField>
      <FilterField label="Outcome">
        <Select
          options={OUTCOMES.map((value) => ({
            value,
            label: value === "" ? "All outcomes" : AUDIT_OUTCOME_LABEL[value],
          }))}
          value={props.presenter.filter().outcome}
          onChange={(outcome) => props.presenter.setFilter({ outcome })}
        />
      </FilterField>
      <FilterField label="Logged from">
        <Input
          type="date"
          value={props.presenter.filter().from}
          onInput={(event) => props.presenter.setFilter({ from: event.currentTarget.value })}
        />
      </FilterField>
      <FilterField label="Logged to">
        <Input
          type="date"
          value={props.presenter.filter().to}
          onInput={(event) => props.presenter.setFilter({ to: event.currentTarget.value })}
        />
      </FilterField>
      <Show when={hasFilter(props.presenter.filter)}>
        <div class="flex items-end">
          <Button size="sm" variant="ghost" onClick={() => props.presenter.clearFilter()}>
            Clear filters
          </Button>
        </div>
      </Show>
    </>
  );
}

/**
 * What one row touched. `target_id` is the row in the database and `target_label` is what a person
 * called it, and an audit trail needs both: the name to recognise it, the id to go and find it when
 * the name has since changed or the thing is gone.
 */
function TargetDialog(props: { row: AuditRow | null; onClose: () => void }): JSX.Element {
  // Read once, on open: `reset` tears the dialog down rather than changing it, and holding the
  // accessor would read a null row on the way out.
  const row = (): AuditRow | null => props.row;
  return (
    <Dialog
      size="lg"
      open={row() !== null}
      onClose={() => props.onClose()}
      title="Target"
      description={`What ${row()?.action ?? "this"} acted on.`}
    >
      <dl class="grid gap-3 text-sm">
        <div class="grid gap-1">
          <dt class="text-xs text-muted">Kind</dt>
          <dd>{row()?.target_type}</dd>
        </div>
        <div class="grid gap-1">
          <dt class="text-xs text-muted">Name at the time</dt>
          <dd>
            <Show
              when={row()?.target_label}
              fallback={
                <span class="text-muted">
                  Not recorded. This row predates the column that keeps it.
                </span>
              }
            >
              {(label) => <span class="font-medium text-heading">{label()}</span>}
            </Show>
          </dd>
        </div>
        <div class="grid gap-1">
          <dt class="text-xs text-muted">Id</dt>
          <dd>
            <code class="text-xs break-all">{row()?.target_id}</code>
          </dd>
        </div>
      </dl>
    </Dialog>
  );
}

export default function AuditView(): JSX.Element {
  const presenter = createAuditPresenter();
  const [open, setOpen] = createSignal(false);
  /** The row whose target is being read, null when the dialog is shut. */
  const [looking, setLooking] = createSignal<AuditRow | null>(null);
  return (
    <section class="grid gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Every write, by whom, and how it ended."
        actions={
          <>
            <TableSearch
              placeholder="Search logs..."
              value={presenter.filter().q}
              onInput={(value) => presenter.setFilter({ q: value })}
            />
            <FilterToggle
              open={open()}
              active={activeCount(presenter.filter)}
              onToggle={() => setOpen((value) => !value)}
            />
          </>
        }
      />
      <FilterPanel open={open()}>
        <Filters presenter={presenter} />
      </FilterPanel>
      <Loading fallback={<Pending>Loading audit rows...</Pending>}>
        <Table>
          <thead>
            <tr>
              <Head>Actor</Head>
              <Head>Action</Head>
              <Head>Target</Head>
              <Head>When</Head>
              <Head>Outcome</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.rows().length > 0}
              fallback={
                <EmptyRow>
                  <Show
                    when={hasFilter(presenter.filter)}
                    fallback="Nothing in the audit log yet. Every login and every change lands here."
                  >
                    No rows match this filter. Try a broader action or actor, or clear it.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.rows()}>
                {(row) => (
                  <Row>
                    <Cell class="whitespace-nowrap">
                      <span class="inline-flex items-center gap-1.5">
                        <Icon
                          name={ACTOR_ICON[row.actor.kind]}
                          class="h-3.5 w-3.5 shrink-0 text-muted"
                        />
                        {/* actor.label is a username (<=64) for a user row but a token's own name
                            for a token row, and token names carry no length cap. */}
                        <span class="max-w-[12rem] truncate" title={row.actor.label}>
                          {row.actor.label}
                        </span>
                      </span>
                    </Cell>
                    <Cell>
                      {/* action is an internal event name with no defined cap ("module.verb"),
                          unlike the enum-backed columns beside it. */}
                      <code class="block max-w-[18rem] truncate" title={row.action}>
                        {row.action}
                      </code>
                    </Cell>
                    <Cell class="whitespace-nowrap">
                      {/* What kind of thing, and the thing itself only when you ask. A uuid down
                          every row answers "which record" and never "which thing", and it was the
                          widest column on the screen to say it. Opening it in a dialog rather than
                          in place keeps every other row where it was while you read one. */}
                      <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted ring ring-hairline hover:bg-hover hover:text-body"
                        onClick={() => setLooking(row)}
                      >
                        {row.target_type}
                        <Icon name="external-link" class="h-3 w-3" />
                      </button>
                    </Cell>
                    <Cell class="whitespace-nowrap tabular-nums">{formatWhen(row.created_at)}</Cell>
                    <Cell>
                      <Badge
                        variant={row.outcome === null ? "secondary" : OUTCOME_VARIANT[row.outcome]}
                      >
                        {row.outcome === null ? "n/a" : AUDIT_OUTCOME_LABEL[row.outcome]}
                      </Badge>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter
          shown={presenter.rows().length}
          noun="rows"
          hasMore={presenter.hasNext()}
          total={presenter.total()}
        >
          {/* Page by page rather than one growing list: you read a page of a log, then the one
              before it. A keyset cursor only points forwards, so the way back is the cursors
              already used. */}
          <Button
            size="sm"
            variant="secondary"
            disabled={presenter.depth() === 0}
            onClick={() => presenter.previous()}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!presenter.hasNext()}
            onClick={() => presenter.next()}
          >
            Next
          </Button>
        </TableFooter>
      </Loading>
      <TargetDialog row={looking()} onClose={() => setLooking(null)} />
    </section>
  );
}
