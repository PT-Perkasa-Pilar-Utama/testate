import type { JSX } from "@solidjs/web";
import { For, createSignal } from "solid-js";

const TOAST_MS = 4000;
/** Older toasts drop off so the stack never grows past this. */
const MAX_TOASTS = 3;

export type ToastTone = "info" | "success" | "error";
type Toast = { id: number; message: string; tone: ToastTone };

const TONES = {
  info: "bg-kumo-info-tint text-kumo-info",
  success: "bg-kumo-success-tint text-kumo-success",
  error: "bg-kumo-danger-tint text-kumo-danger",
} as const;

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

/** Shows a short message at the bottom of the page. */
export function showToast(message: string, tone: ToastTone = "info"): void {
  const id = nextId;
  nextId += 1;
  setToasts((current) => [...current, { id, message, tone }].slice(-MAX_TOASTS));
  setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_MS);
}

/** Surfaces a caught error to the user; the English message is kept for the console. */
export function reportError(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  showToast(message, "error");
}

/** Runs a detached async action from an event handler and reports its failure. */
export async function attempt(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (cause: unknown) {
    reportError(cause);
  }
}

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
