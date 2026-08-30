import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { toasts } from "@/lib/toast.ts";
import type { ToastTone } from "@/lib/toast.ts";

const TONES = {
  info: "bg-kumo-info-tint text-kumo-info ring-kumo-info/40",
  success: "bg-kumo-success-tint text-kumo-success ring-kumo-success/40",
  error: "bg-kumo-danger-tint text-kumo-danger ring-kumo-danger/40",
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
          <div class={["rounded-md px-4 py-2 text-base shadow-md ring", TONES[toast.tone]]}>
            {toast.message}
          </div>
        )}
      </For>
    </div>
  );
}
