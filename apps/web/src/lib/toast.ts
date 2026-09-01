import { humanMessage } from "./api-error.ts";
import { createSignal } from "solid-js";

const TOAST_MS = 4000;
/** Older toasts drop off so the stack never grows past this. */
const MAX_TOASTS = 3;

export type ToastTone = "info" | "success" | "error";
export type Toast = { id: number; message: string; tone: ToastTone };

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

export { toasts };

/** Shows a short message at the bottom of the page. */
export function showToast(message: string, tone: ToastTone = "info"): void {
  const id = nextId;
  nextId += 1;
  setToasts((current) => [...current, { id, message, tone }].slice(-MAX_TOASTS));
  setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_MS);
}

/**
 * Surfaces a caught error to the user, in the app's words rather than the API's.
 *
 * Every `attempt` in the app lands here, which made this the widest leak: a session that ended
 * showed "authentication required" and a missing row showed "adapter not found". The server's own
 * wording is still in the response, the wide event and the audit row for whoever is debugging.
 */
export function reportError(cause: unknown): void {
  showToast(humanMessage(cause, "That did not work."), "error");
}

/** Runs a detached async action from an event handler and reports its failure. */
export async function attempt(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (cause: unknown) {
    reportError(cause);
  }
}
