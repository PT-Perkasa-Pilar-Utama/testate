import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { ImportReport } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { blockedReason, commitPrompt, reportCounts } from "./imports.helpers.ts";
import MappingStep from "./imports.mapping.view.tsx";
import ReportPanel from "./imports.report.view.tsx";
import SourceStep from "./imports.source.view.tsx";
import type { WizardPresenter } from "./imports.wizard.presenter.ts";

/**
 * The mapping form's own action bar. There is exactly one way forward from here — a preview — so
 * there is nothing to press twice by mistake (defect 5): the real write only happens one screen on.
 */
function MappingForm(props: { presenter: WizardPresenter }): JSX.Element {
  const blocked = (): string | null =>
    blockedReason(props.presenter.draft(), props.presenter.preview() !== null);
  return (
    <div class="grid gap-4">
      <SourceStep presenter={props.presenter} />
      <Show when={props.presenter.preview() !== null}>
        <MappingStep presenter={props.presenter} />
      </Show>
      <Show when={props.presenter.error()}>
        {(message) => <Banner variant="error">{message()}</Banner>}
      </Show>
      <div class="grid justify-items-end gap-1.5">
        <div class="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={blocked() !== null || props.presenter.busy()}
            onClick={() => void props.presenter.run(true)}
          >
            {props.presenter.busy() ? "Checking the file…" : "Preview import"}
          </Button>
        </div>
        <Show when={!props.presenter.busy() && blocked() !== null}>
          <p class="text-sm text-muted">{blocked()}</p>
        </Show>
      </div>
    </div>
  );
}

/**
 * The commit step (defect 5): the dry-run result stated as a fact right beside the one button that
 * actually writes anything, so nothing here can be mistaken for "done" when it is only a preview.
 */
function CommitStep(props: { presenter: WizardPresenter; report: ImportReport }): JSX.Element {
  const counts = () => reportCounts(props.report);
  const canImport = (): boolean => counts().ready > 0 && !props.presenter.busy();
  const importLabel = (): string => {
    if (props.presenter.busy()) return "Importing…";
    if (counts().ready === 0) return "Nothing to import";
    return `Import ${counts().ready.toLocaleString("en-GB")} rows`;
  };
  return (
    <div class="grid gap-2">
      <p class="text-sm text-muted">A stash is taken first, so this is easy to undo.</p>
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-fill px-4 py-3 ring ring-line">
        <p class="text-base text-body">{commitPrompt(counts())}</p>
        <div class="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.back()}>
            Back to mapping
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canImport()}
            onClick={() => void props.presenter.run(false)}
          >
            {importLabel()}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function WizardDialog(props: {
  presenter: WizardPresenter;
  rejectedUrl: (runId: string) => string;
}): JSX.Element {
  return (
    <Dialog
      open={props.presenter.open()}
      onClose={() => props.presenter.close()}
      title="Import a file"
      description="Load a file, match its columns to one table, and preview what it will do before anything changes."
      size="xl"
    >
      <Show when={props.presenter.report()} fallback={<MappingForm presenter={props.presenter} />}>
        {(report) => (
          <Show
            when={report().dry_run}
            fallback={
              <div class="grid gap-4">
                <ReportPanel
                  report={report()}
                  rejectedUrl={props.rejectedUrl(report().run_id)}
                  onClose={() => props.presenter.close()}
                  closeLabel="Done"
                />
                <Show when={props.presenter.error()}>
                  {(message) => <Banner variant="error">{message()}</Banner>}
                </Show>
              </div>
            }
          >
            <div class="grid gap-4">
              <ReportPanel
                report={report()}
                rejectedUrl={props.rejectedUrl(report().run_id)}
                onClose={() => props.presenter.close()}
                footer={<CommitStep presenter={props.presenter} report={report()} />}
              />
              <Show when={props.presenter.error()}>
                {(message) => <Banner variant="error">{message()}</Banner>}
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </Dialog>
  );
}
