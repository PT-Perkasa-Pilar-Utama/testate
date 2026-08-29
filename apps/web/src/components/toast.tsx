import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { toasts } from "@/lib/toast.ts";
import type { ToastTone } from "@/lib/toast.ts";

const TONES = {
  info: "bg-kumo-info-tint text-kumo-info",
  success: "bg-kumo-success-tint text-kumo-success",
  error: "bg-kumo-danger-tint text-kumo-danger",
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
              "rounded-lg px-4 py-2 text-base shadow-md ring ring-kumo-line",
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
