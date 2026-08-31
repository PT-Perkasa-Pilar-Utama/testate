import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { countsLabel, createImportsPresenter } from "./imports.presenter.ts";
import ReportPanel from "./imports.report.view.tsx";
import { createWizardPresenter } from "./imports.wizard.presenter.ts";
import WizardDialog from "./imports.wizard.view.tsx";

const LINK = buttonClass("ghost", "sm");

export default function ImportsView(props: { slug: string }): JSX.Element {
  const presenter = createImportsPresenter(() => props.slug);
  const wizard = createWizardPresenter(
    () => props.slug,
    () => presenter.refresh()
  );
  return (
    <div class="grid gap-3">
      <Show when={hasRole("qa")}>
        <div class="flex justify-end">
          <Button variant="primary" onClick={() => wizard.start()}>
            New import
          </Button>
        </div>
      </Show>
      <Loading fallback={<p class="text-muted">Loading import runs...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Run</Head>
              <Head>Mode</Head>
              <Head>Dry run</Head>
              <Head>Counts</Head>
              <Head>By</Head>
              <Head>Started</Head>
              <Head pinned>Actions</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No imports yet. Load a CSV or XLSX into a table, with a dry run first.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(run) => (
                  <Row>
                    <Cell>
                      <code>{run.id.slice(-8)}</code>
                    </Cell>
                    <Cell>{run.mode}</Cell>
                    <Cell>
                      <Badge variant={run.dry_run ? "info" : "outline"}>
                        {run.dry_run ? "yes" : "no"}
                      </Badge>
                    </Cell>
                    <Cell>{countsLabel(run)}</Cell>
                    <Cell class="whitespace-nowrap">{run.actor.label}</Cell>
                    <Cell class="whitespace-nowrap">{formatWhen(run.created_at)}</Cell>
                    <Cell pinned>
                      <div class="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={run.counts === null}
                          onClick={() => void presenter.openReport(run)}
                        >
                          Report
                        </Button>
                        <Show when={run.rejected_available}>
                          <a class={LINK} href={presenter.rejectedUrl(run.id)}>
                            Rejected rows
                          </a>
                          <Show when={hasRole("qa")}>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => wizard.start({ kind: "rejected", run_id: run.id })}
                            >
                              Re-import rejected
                            </Button>
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
      <WizardDialog presenter={wizard} rejectedUrl={(runId) => presenter.rejectedUrl(runId)} />
    </div>
  );
}
