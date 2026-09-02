import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { toasts } from "@/lib/toast.ts";
import type { ToastTone } from "@/lib/toast.ts";

// A raised card with one coloured edge, rather than a wash: the message reads in body text and
// the tone is a glance at the left.
const TONES = {
  info: "border-l-info",
  success: "border-l-success",
  error: "border-l-danger",
} satisfies Record<ToastTone, string>;

/** Mount once, near the end of the app tree. */
export default function Toaster(): JSX.Element {
  return (
    <div
      class="pointer-events-none fixed right-4 bottom-16 z-50 flex max-w-[320px] flex-col items-end gap-2"
      aria-live="polite"
    >
      <For each={toasts()}>
        {(toast) => (
          <div
            class={[
              "rounded-md border-l-2 bg-surface px-4 py-2.5 text-base text-body shadow-lg shadow-black/40 ring ring-line",
              TONES[toast.tone],
            ]}
          >
            {toast.message}
          </div>
        )}
      </For>
    </div>
  );
}
