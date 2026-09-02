import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { ImportReport } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import { reportCounts, reportSummary } from "./imports.helpers.ts";

const REJECTED_LINK = buttonClass("ghost");

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export type ReportPanelProps = {
  report: ImportReport;
  rejectedUrl: string;
  onClose: () => void;
  /** Defaults to "Close"; the wizard passes "Done" once a real run has actually finished. */
  closeLabel?: string;
  /** Replaces the default Rejected-rows-and-close row; the wizard uses this for the commit step. */
  footer?: JSX.Element | undefined;
};

/**
 * What a preview found, or what a run did (stories 56, 58). Never the raw counters off the wire:
 * "inserted 0 · updated 0 · skipped 1204 · failed 2" told a person nothing without reading the code.
 */
export default function ReportPanel(props: ReportPanelProps): JSX.Element {
  const counts = () => reportCounts(props.report);
  return (
    <div class="grid gap-4">
      <Banner variant={props.report.failed === 0 ? "default" : "alert"}>
        <div class="grid gap-0.5">
          <p class="font-medium">
            {props.report.dry_run
              ? "Preview only. Nothing has been imported yet."
              : "Import complete."}
          </p>
          <p>{reportSummary(counts(), props.report.dry_run)}</p>
        </div>
      </Banner>
      <Show when={props.report.stash_state_id !== null}>
        <p class="text-sm text-muted">
          A stash was taken first. Check it out from States if you need to undo this.
        </p>
      </Show>
      <Show when={props.report.errors_preview.length > 0}>
        <div class="grid gap-1">
          <p class="text-sm font-medium text-heading">First rejected rows</p>
          <ul class="grid gap-1 text-sm text-muted">
            <For each={props.report.errors_preview}>
              {(item) => (
                <li>
                  row {item.row_number}: {item.reason}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <p class="text-xs text-muted">took {formatDuration(props.report.duration_ms)}</p>
      <Show
        when={props.footer}
        fallback={
          <div class="flex justify-end gap-2">
            <Show when={props.report.rejected_available}>
              <a class={REJECTED_LINK} href={props.rejectedUrl}>
                Rejected rows
              </a>
            </Show>
            <Button type="button" variant="ghost" onClick={() => props.onClose()}>
              {props.closeLabel ?? "Close"}
            </Button>
          </div>
        }
      >
        {props.footer}
      </Show>
    </div>
  );
}
