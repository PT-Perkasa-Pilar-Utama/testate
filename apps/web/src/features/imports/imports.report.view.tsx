import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { ImportReport } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";

/** Inserted, updated, skipped, failed, and the first errors of one run (stories 56, 58). */
export default function ReportPanel(props: {
  report: ImportReport;
  rejectedUrl: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div class="grid gap-4">
      <Banner variant={props.report.failed === 0 ? "default" : "alert"}>
        {props.report.dry_run ? "Dry run" : "Import"}: inserted {props.report.inserted} · updated{" "}
        {props.report.updated} · skipped {props.report.skipped} · failed {props.report.failed} ·{" "}
        {props.report.duration_ms} ms
      </Banner>
      <Show when={props.report.stash_state_id}>
        <p class="text-muted text-sm">A stash was taken first; check it out to undo.</p>
      </Show>
      <Show when={props.report.errors_preview.length > 0}>
        <ul class="grid gap-1 text-sm">
          <For each={props.report.errors_preview}>
            {(item) => (
              <li>
                row {item.row_number}: {item.reason}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="flex justify-end gap-2">
        <Show when={props.report.rejected_available}>
          <a
            class="inline-flex h-9 items-center rounded-lg px-3 hover:bg-hover"
            href={props.rejectedUrl}
          >
            Rejected rows
          </a>
        </Show>
        <Button type="button" variant="ghost" onClick={() => props.onClose()}>
          Close
        </Button>
      </div>
    </div>
  );
}
