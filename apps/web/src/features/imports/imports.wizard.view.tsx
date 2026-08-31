import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { blockedReason, commitButtonLabel, commitPrompt, reportCounts } from "./imports.helpers.ts";
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
 *
 * It reads the report off the presenter rather than taking the value narrowed by the enclosing
 * <Show>. A narrowed accessor throws once its condition goes false, and this component's own
 * "Back to mapping" clears the report: the button's children recomputed on the next flush, read
 * the dead accessor, and took the whole screen into the error boundary.
 */
function CommitStep(props: { presenter: WizardPresenter }): JSX.Element {
  const counts = (): ReturnType<typeof reportCounts> | null => {
    const report = props.presenter.report();
    return report === null ? null : reportCounts(report);
  };
  const ready = (): number => counts()?.ready ?? 0;
  const canImport = (): boolean => ready() > 0 && !props.presenter.busy();
  const importLabel = (): string => {
    if (props.presenter.busy()) return "Importing…";
    if (ready() === 0) return "Nothing to import";
    return commitButtonLabel(ready());
  };
  return (
    <Show when={counts()}>
      {(ready_) => (
        <div class="grid gap-2">
          <p class="text-sm text-muted">A stash is taken first, so this is easy to undo.</p>
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-fill px-4 py-3 ring ring-line">
            <p class="text-base text-body">{commitPrompt(ready_())}</p>
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
      )}
    </Show>
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
      {/*
        One <Show>, not two, and a ternary rather than a nested one.

        <Show> wraps its `when` in a memo. A nested <Show> whose `when` read this callback's
        accessor kept that memo alive past the outer condition flipping, so it read a narrowed
        value that no longer existed: Solid threw its stale-value error and the whole screen fell
        into the error boundary. A ternary in a prop is a getter and creates no such memo.
      */}
      <Show when={props.presenter.report()} fallback={<MappingForm presenter={props.presenter} />}>
        {(report) => (
          <div class="grid gap-4">
            <ReportPanel
              report={report()}
              rejectedUrl={props.rejectedUrl(report().run_id)}
              onClose={() => props.presenter.close()}
              closeLabel={report().dry_run ? "Close" : "Done"}
              footer={report().dry_run ? <CommitStep presenter={props.presenter} /> : undefined}
            />
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
