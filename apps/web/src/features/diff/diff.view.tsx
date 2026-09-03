import type { JSX } from "@solidjs/web";
import EmptyState from "@/components/empty-state.tsx";
import Icon from "@/components/icon.tsx";
import Pending from "@/components/pending.tsx";
import { Eyebrow } from "@/components/page-header.tsx";
import { Errored, For, Loading, Show, createEffect } from "solid-js";
import type { Diff, DiffTable } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Breadcrumbs from "@/components/breadcrumbs.tsx";
import PageHeader from "@/components/page-header.tsx";
import Tabs from "@/components/tabs.tsx";
import { DIFF_OP_LABEL } from "@/lib/labels.ts";
import { formatWhen } from "@/lib/format.ts";
import DocumentPairs from "./diff.documents.view.tsx";
import {
  columnsOf,
  createDiffPresenter,
  moved,
  tableName,
  wantedTarget,
} from "./diff.presenter.ts";
import type { DiffPresenter, Target } from "./diff.presenter.ts";
import RowTable from "./diff.rows.view.tsx";
import ValueDialog from "./diff.value.tsx";

type DiffAdapter = Diff["adapters"][number];

const OPS = [
  { id: "", label: "All" },
  { id: "added", label: DIFF_OP_LABEL.added },
  { id: "removed", label: DIFF_OP_LABEL.removed },
  { id: "changed", label: DIFF_OP_LABEL.changed },
] as const;

const documents = (adapter: DiffAdapter): boolean => adapter.engine === "mongodb";

function targetName(diff: Diff): string {
  return "live" in diff.target ? "live databases" : diff.target.name;
}

/** What moved in a table, each count in the colour the diff rows use for it; nothing when nothing did. */
function Counts(props: { table: DiffTable }): JSX.Element {
  return (
    <span class="ml-auto flex shrink-0 gap-1.5 font-mono text-xs tabular-nums">
      <Show when={props.table.added > 0}>
        <span class="text-success-fg">+{props.table.added}</span>
      </Show>
      <Show when={props.table.removed > 0}>
        <span class="text-danger-fg">-{props.table.removed}</span>
      </Show>
      <Show when={props.table.changed > 0}>
        <span class="text-warning-fg">~{props.table.changed}</span>
      </Show>
    </span>
  );
}

/**
 * What moved, and only that: the databases with a table or collection that changed, and those
 * tables. A database where nothing moved has nothing to pick, so it is not listed.
 */
function TableRail(props: { presenter: DiffPresenter }): JSX.Element {
  const key = (target: Target): string => `${target.adapter_id}/${tableName(target.table)}`;
  const chosen = (target: Target): boolean => {
    const at = props.presenter.target();
    return at !== null && key(at) === key(target);
  };
  const touched = (): DiffAdapter[] =>
    props.presenter.diff.value().adapters.filter((adapter) => adapter.tables.some(moved));
  return (
    <nav class="grid gap-5" aria-label="What moved">
      <For each={touched()} fallback={<p class="px-2 text-sm text-muted">Nothing moved.</p>}>
        {(adapter) => (
          <div class="grid gap-1">
            <h3 class="flex items-center gap-1.5 px-2">
              <Icon name="database" class="h-3.5 w-3.5 text-muted" />
              <Eyebrow>{adapter.name}</Eyebrow>
            </h3>
            <For each={adapter.tables.filter(moved)}>
              {(table) => (
                <button
                  type="button"
                  class={[
                    "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-[80ms] hover:bg-hover",
                    chosen({ adapter_id: adapter.adapter_id, adapter_name: adapter.name, table })
                      ? "bg-fill text-heading before:absolute before:top-2 before:bottom-2 before:-left-px before:w-0.5 before:rounded-full before:bg-accent"
                      : "text-muted",
                  ]}
                  onClick={() =>
                    void props.presenter.select({
                      adapter_id: adapter.adapter_id,
                      adapter_name: adapter.name,
                      table,
                    })
                  }
                >
                  <Icon
                    name={documents(adapter) ? "folder" : "table"}
                    class="h-3.5 w-3.5 shrink-0"
                  />
                  <span class="truncate">{tableName(table)}</span>
                  <Counts table={table} />
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </nav>
  );
}

/**
 * One diff, on a page of its own: what moved on the left, both sides of each row or document on
 * the right. No API work: `GET /diffs/:id/rows` already answers with before, after and the
 * columns that changed.
 */
export default function DiffView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createDiffPresenter(
    () => props.slug,
    () => props.id
  );
  const columns = (): string[] => columnsOf(presenter.page()?.data ?? []);
  const rows = () => presenter.page()?.data ?? [];
  const adapterOf = (target: Target): DiffAdapter | undefined =>
    presenter.diff.value().adapters.find((adapter) => adapter.adapter_id === target.adapter_id);
  const noun = (target: Target): string =>
    adapterOf(target)?.engine === "mongodb" ? "documents" : "rows";
  // Read once, at build: a link from a state's page names the table it wants open.
  const search = window.location.search;
  // Land on the table the link named, else the first that moved: a page that lands on an
  // instruction made the reader do the one thing it already knew to do.
  createEffect(
    () => ({ diff: presenter.diff.value(), target: presenter.target() }),
    ({ diff, target }) => {
      if (target !== null) return;
      const pick = wantedTarget(diff, search);
      // On the next turn, not inside the effect: `select` reads the presenter's own signals.
      if (pick !== null) queueMicrotask(() => void presenter.select(pick));
    }
  );
  return (
    <section class="grid gap-4">
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<Pending>Loading the diff...</Pending>}>
          <Breadcrumbs
            items={[
              { label: "Projects", href: "/projects" },
              { label: props.slug, href: `/projects/${props.slug}` },
              { label: "activity", href: `/projects/${props.slug}?tab=activity&show=diffs` },
              { label: "diff" },
            ]}
          />
          <PageHeader
            eyebrow="Comparison"
            title={`${presenter.diff.value().base.name} → ${targetName(presenter.diff.value())}`}
            description={`Made ${formatWhen(presenter.diff.value().created_at)}. Kept until ${formatWhen(presenter.diff.value().expires_at)}.`}
          />
          <div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
            <TableRail presenter={presenter} />
            <div class="grid content-start gap-3">
              <Show
                when={presenter.target()}
                fallback={
                  <EmptyState icon="table" title="Nothing moved">
                    Both sides hold the same data.
                  </EmptyState>
                }
              >
                {(target) => (
                  <>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <h3 class="font-medium text-heading">
                        {target().adapter_name} · {tableName(target().table)}
                      </h3>
                      <Tabs
                        items={OPS}
                        value={presenter.op()}
                        onChange={(op) => void presenter.setOp(op)}
                        label={`Which ${noun(target())}`}
                        variant="segmented"
                      />
                    </div>
                    <Show when={(presenter.page()?.masked_columns ?? []).length > 0}>
                      <Banner variant="default">
                        Masked here: {(presenter.page()?.masked_columns ?? []).join(", ")}
                      </Banner>
                    </Show>
                    <Show
                      when={rows().length > 0}
                      fallback={
                        <p class="text-muted">
                          {presenter.busy()
                            ? `Reading ${noun(target())}...`
                            : `No ${noun(target())} for this filter.`}
                        </p>
                      }
                    >
                      <Show
                        when={noun(target()) === "rows"}
                        fallback={<DocumentPairs rows={rows()} />}
                      >
                        <RowTable rows={rows()} columns={columns()} presenter={presenter} />
                      </Show>
                    </Show>
                  </>
                )}
              </Show>
            </div>
          </div>
        </Loading>
      </Errored>
      <ValueDialog cell={presenter.cell()} onClose={() => presenter.closeCell()} />
    </section>
  );
}
