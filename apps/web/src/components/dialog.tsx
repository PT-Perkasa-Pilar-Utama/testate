import type { JSX } from "@solidjs/web";
import { Show, createEffect, createSignal } from "solid-js";

import Button from "./button.tsx";

// Size strings come from the Kumo registry entry "Dialog".
const SIZES = {
  sm: "sm:w-72",
  base: "sm:w-96",
  lg: "sm:w-[32rem]",
  xl: "sm:w-[48rem]",
} as const;

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZES;
  children: JSX.Element;
};

/** Native `<dialog>`: focus trapping, Escape, and the backdrop come from the browser. */
export default function Dialog(props: DialogProps): JSX.Element {
  const [element, setElement] = createSignal<HTMLDialogElement>();

  createEffect(
    () => ({ open: props.open, dialog: element() }),
    ({ open, dialog }) => {
      if (dialog === undefined) return;
      if (open && !dialog.open) dialog.showModal();
      if (!open && dialog.open) dialog.close();
    }
  );

  return (
    <dialog
      ref={setElement}
      class={[
        "m-auto max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-kumo-elevated p-0 text-kumo-default shadow-xl ring ring-kumo-line backdrop:bg-kumo-contrast/40",
        SIZES[props.size ?? "base"],
      ]}
      onClose={() => props.onClose()}
    >
      <div class="flex flex-col gap-4 p-6">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col gap-1">
            <h2 class="text-lg font-semibold text-kumo-strong">{props.title}</h2>
            <Show when={props.description}>
              <p class="text-base text-kumo-subtle">{props.description}</p>
            </Show>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={() => props.onClose()}>
            ✕
          </Button>
        </div>
        {props.children}
      </div>
    </dialog>
  );
}
