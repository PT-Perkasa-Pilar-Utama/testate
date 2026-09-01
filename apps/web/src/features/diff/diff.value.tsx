import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Dialog from "@/components/dialog.tsx";
import type { CellPair } from "./diff.presenter.ts";
import { unified } from "./diff.text.ts";

const TONE = {
  same: "text-body",
  before: "bg-danger-tint text-danger-fg",
  after: "bg-success-tint text-success-fg",
} as const;

const SIGN = { same: "  ", before: "- ", after: "+ " } as const;

/** One column's before and after, unified, because a wide value reads worse side by side. */
export default function ValueDialog(props: {
  cell: CellPair | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Show when={props.cell}>
      {(cell) => (
        <Dialog
          open
          onClose={() => props.onClose()}
          title={cell().column}
          description="The value before and after, line by line. Matching lines are shown once."
          size="xl"
        >
          <pre class="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-xs">
            <For each={unified(cell().before, cell().after)}>
              {(line) => (
                <div class={TONE[line.side]}>
                  <span aria-hidden="true">{SIGN[line.side]}</span>
                  {line.text}
                </div>
              )}
            </For>
          </pre>
        </Dialog>
      )}
    </Show>
  );
}
