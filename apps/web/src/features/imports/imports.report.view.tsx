import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { ImportReport } from "@testate/shared";

import Button, { buttonClass } from "@/components/button.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { rejectionGroups, reportCounts, rowRanges } from "./imports.helpers.ts";

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

/** One number with its word under it. */
function Stat(props: {
  value: number;
  label: string;
  tone: "good" | "bad" | "plain";
}): JSX.Element {
  return (
    <div class="grid gap-0.5 rounded-lg bg-surface px-4 py-3 ring ring-line">
      <span
        class={[
          "text-2xl font-semibold tabular-nums",
          props.tone === "bad" && props.value > 0 ? "text-danger-fg" : "",
          props.tone === "good" && props.value > 0 ? "text-success-fg" : "",
          props.value === 0 || props.tone === "plain" ? "text-heading" : "",
        ]}
      >
        {props.value.toLocaleString("en-GB")}
      </span>
      <span class="text-xs text-muted">{props.label}</span>
    </div>
  );
}

/**
 * What a preview found, or what a run did (stories 56, 58): two numbers, then every problem
 * once with the rows it hit. Eight lines of the same sentence told a person one thing eight times.
 */
export default function ReportPanel(props: ReportPanelProps): JSX.Element {
  const counts = () => reportCounts(props.report);
  const groups = () => rejectionGroups(props.report.errors_preview);
  return (
    <div class="grid gap-4">
      <p class="text-sm text-muted">
        {props.report.dry_run ? "Preview. Nothing was written." : "Imported."}{" "}
        <span class="tabular-nums">Took {formatDuration(props.report.duration_ms)}.</span>
        <Show when={props.report.stash_state_id !== null}>
          {" "}
          A stash was taken first. Check it out from States to undo this.
        </Show>
      </p>
      <div class="grid grid-cols-2 gap-3">
        <Stat
          value={counts().ready}
          label={props.report.dry_run ? "rows ready" : "rows imported"}
          tone="good"
        />
        <Stat
          value={counts().rejected}
          label={props.report.dry_run ? "rows will be rejected" : "rows rejected"}
          tone="bad"
        />
      </div>
      <Show when={groups().length > 0}>
        <Table>
          <thead>
            <tr>
              <Head>Problem</Head>
              <Head>Rows</Head>
            </tr>
          </thead>
          <tbody>
            <For each={groups()}>
              {(group) => (
                <Row>
                  <Cell wrap>{group.reason}</Cell>
                  <Cell class="whitespace-nowrap font-mono text-xs">{rowRanges(group.rows)}</Cell>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
        <Show when={props.report.errors_preview.length < props.report.failed}>
          <p class="text-xs text-muted">
            The first {props.report.errors_preview.length} of {props.report.failed}. Rejected rows
            holds every one.
          </p>
        </Show>
      </Show>
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
