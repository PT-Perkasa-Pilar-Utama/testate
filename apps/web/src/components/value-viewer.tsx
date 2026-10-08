import type { JSX } from "@solidjs/web";
import type { JsonValue } from "@testate/shared";
import { Show, createSignal } from "solid-js";

import { showToast } from "@/lib/toast.ts";
import { fullValueOf, needsViewer, oneLine, pretty } from "@/lib/value-view.ts";
import Button from "./button.tsx";
import Dialog, { DialogActions } from "./dialog.tsx";
import Icon from "./icon.tsx";
import JsonView from "./json-view.tsx";

/** Every data table cuts a value at this width, so a long value costs the same in each of them. */
export const CELL_WIDTH = "max-w-[18rem]";

/** A tooltip is a preview, not the value: a page of JSON in a native tooltip cannot be read. */
const PREVIEW = 200;

type Viewing = { title: string; value: JsonValue };

// One dialog for the whole app, opened from any cell. `shown` outlives `open` so the dialog keeps
// its content while it animates closed.
const [open, setOpen] = createSignal(false);
const [shown, setShown] = createSignal<Viewing | null>(null);

export function openValue(title: string, value: JsonValue): void {
  setShown({ title, value });
  setOpen(true);
}

function preview(value: JsonValue | undefined): string {
  const line = oneLine(value);
  return line.length > PREVIEW ? `${line.slice(0, PREVIEW)}…` : line;
}

async function copy(value: JsonValue): Promise<void> {
  try {
    await navigator.clipboard.writeText(pretty(value));
    showToast("Copied to clipboard", "success");
  } catch {
    // The clipboard needs HTTPS or localhost, and an intranet instance is often plain HTTP.
    showToast("The browser refused to copy. Select the text instead.", "error");
  }
}

/**
 * A value in a data table: one line, cut at the shared width. A value the cell cannot show whole
 * (JSON, a line break, a long string) is a button that opens it in full.
 */
export function ValueCell(props: { value: JsonValue | undefined; title: string }): JSX.Element {
  const line = (): string => oneLine(props.value);
  const missing = (): boolean => props.value === undefined || props.value === null;
  return (
    <Show
      when={needsViewer(props.value)}
      fallback={
        <span
          class={["block truncate", CELL_WIDTH, { "text-muted": missing() }]}
          title={preview(props.value)}
        >
          {line()}
        </span>
      }
    >
      <button
        type="button"
        class={[
          "block cursor-pointer truncate text-left decoration-line underline-offset-2 hover:underline",
          CELL_WIDTH,
        ]}
        title={preview(props.value)}
        onClick={() => openValue(props.title, props.value ?? null)}
      >
        {line()}
      </button>
    </Show>
  );
}

/** The dialog `ValueCell` opens. Mounted once, beside the toaster. */
export function ValueViewer(): JSX.Element {
  return (
    <Dialog
      open={open()}
      onClose={() => setOpen(false)}
      title={shown()?.title ?? ""}
      description="The whole value. JSON is laid out over lines."
      size="xl"
    >
      <Show when={shown()}>
        {(viewing) => (
          <div class="grid gap-4">
            <div class="max-h-[60vh] overflow-auto rounded-lg bg-sunken px-4 py-3 ring ring-line">
              <Show
                when={fullValueOf(viewing().value).kind === "json"}
                fallback={
                  <pre class="font-mono text-sm leading-6 break-words whitespace-pre-wrap select-text">
                    {pretty(viewing().value)}
                  </pre>
                }
              >
                <JsonView value={jsonOf(viewing().value)} />
              </Show>
            </div>
            <DialogActions>
              <Button variant="secondary" onClick={() => void copy(viewing().value)}>
                <Icon name="copy" class="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogActions>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

/** The structured form of a value, for `JsonView`; a JSON string comes back parsed. */
function jsonOf(value: JsonValue): JsonValue {
  const full = fullValueOf(value);
  return full.kind === "json" ? full.value : full.text;
}
