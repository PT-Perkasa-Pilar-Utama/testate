import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import Select from "@/components/select.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  SortColumn,
  Table,
  TableSearch,
  Truncated,
} from "@/components/table.tsx";
import { IMPORT_MODE_OPTIONS } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { modeLabel } from "./imports.helpers.ts";
import { countsLabel, createImportsPresenter } from "./imports.presenter.ts";
import type { ImportModeFilter } from "./imports.presenter.ts";
import ReportPanel from "./imports.report.view.tsx";

const LINK = buttonClass("outline", "sm");
const MODE_FILTER_OPTIONS: { value: ImportModeFilter; label: string }[] = [
  { value: "", label: "All" },
  ...IMPORT_MODE_OPTIONS,
];

export default function ImportsView(props: { slug: string }): JSX.Element {
  const presenter = createImportsPresenter(() => props.slug);
  return (
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <TableSearch
          placeholder="Search imports..."
          value={presenter.table.query()}
          onInput={(value) => presenter.table.setQuery(value)}
        />
        <FilterToggle
          open={presenter.filtersOpen()}
          active={presenter.activeFilters()}
          onToggle={() => presenter.toggleFilters()}
        />
      </div>
      <FilterPanel open={presenter.filtersOpen()}>
        <FilterField label="What happens">
          <Select
            options={MODE_FILTER_OPTIONS}
            value={presenter.modeFilter()}
            onChange={(value) => presenter.setModeFilter(value)}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<Pending>Loading import runs...</Pending>}>
        <Table>
          <thead>
            <tr>
              <Head>Run</Head>
              <SortColumn view={presenter.table} column="mode">
                What happens
              </SortColumn>
              <Head>Type</Head>
              <Head>Result</Head>
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
                    when={presenter.value().length > 0}
                    fallback="No imports yet. Bring in a CSV or XLSX file and preview it before anything changes."
                  >
                    No import matches your search or filters.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(run) => (
                  <Row>
                    <Cell>
                      <code>{run.id.slice(-8)}</code>
                    </Cell>
                    <Cell>{modeLabel(run.mode)}</Cell>
                    <Cell>
                      <Badge variant={run.dry_run ? "info" : "outline"}>
                        {run.dry_run ? "Preview" : "Import"}
                      </Badge>
                    </Cell>
                    <Cell>{countsLabel(run)}</Cell>
                    <Cell>
                      {/* Same actor.label as jobs and audit: bounded for a username, unbounded
                          for a token's own name. */}
                      <Truncated class="max-w-[12rem]">{run.actor.label}</Truncated>
                    </Cell>
                    <Cell>{formatWhen(run.created_at)}</Cell>
                    <Cell pinned>
                      <div class="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={run.counts === null}
                          onClick={() => void presenter.openReport(run)}
                        >
                          Report
                        </Button>
                        <Show when={run.rejected_available}>
                          <a class={LINK} href={presenter.rejectedUrl(run.id)}>
                            Rejected rows
                          </a>
                          {/* The rejected rows go back through the adapter's own import screen,
                              which is where every import starts now. */}
                          <Show when={hasRole("qa")}>
                            <a
                              class={LINK}
                              href={href(
                                `/projects/${props.slug}/adapters/${run.adapter_id}/imports?rejected=${run.id}&normalizer=${run.normalizer_id}`
                              )}
                            >
                              Re-import rejected
                            </a>
                          </Show>
                        </Show>
                      </div>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
      <Show when={presenter.report()}>
        {(report) => (
          <Dialog open onClose={() => presenter.closeReport()} title="Import report" size="lg">
            <ReportPanel
              report={report()}
              rejectedUrl={presenter.rejectedUrl(report().run_id)}
              onClose={() => presenter.closeReport()}
            />
          </Dialog>
        )}
      </Show>
    </div>
  );
}
