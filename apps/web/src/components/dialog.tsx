import type { JSX } from "@solidjs/web";
import { Show, createEffect, createSignal } from "solid-js";

import Button from "./button.tsx";

// Size strings for the native <dialog>; it is never conditionally rendered.
/**
 * Three widths, chosen by what the dialog holds, never per screen: `base` for a question and its
 * two buttons, `lg` for a form, `xl` for something to read (a report, a preview, a row). `sm` is
 * for nothing yet.
 */
const SIZES = {
  sm: "sm:w-80",
  base: "sm:w-[26rem]",
  lg: "sm:w-[32rem]",
  xl: "sm:w-[48rem]",
} as const;

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  size?: keyof typeof SIZES | undefined;
  /**
   * Asked before every way out, and `false` holds the dialog open.
   *
   * Escape has to be answered here and nowhere else: the browser closes a `<dialog>` on Escape by
   * itself and only the `cancel` event can stop it. By the time `close` fires the dialog is shut,
   * so a guard hung off `onClose` would let Escape walk straight past it.
   */
  beforeClose?: (() => boolean) | undefined;
  /** Called with the dialog the moment the browser opens it. */
  onOpened?: ((dialog: HTMLDialogElement) => void) | undefined;
  children: JSX.Element;
};

/** Native `<dialog>`: focus trapping, Escape, and the backdrop come from the browser. */
export default function Dialog(props: DialogProps): JSX.Element {
  const [element, setElement] = createSignal<HTMLDialogElement>();

  // Both handlers are taken in a compute and called from a plain variable.
  //
  // `dialog.close()` below runs inside an effect callback and fires the native `close` event
  // synchronously, so the handler for it runs there too. Reading `props.onClose` at that moment is
  // a reactive read in an effect callback, which is the mistake Solid 2 warns about; reading it
  // here is not.
  let close: () => void = () => undefined;
  let ours = false;
  createEffect(
    () => props.onClose,
    (handler) => {
      close = handler;
    }
  );
  // `onOpened` is read in the compute, not in the callback below. Props are reactive reads, and a
  // read inside an effect callback is the one Solid 2 warns about: it cannot update anything from
  // there. Taking it here hands the callback a plain function.
  createEffect(
    () => ({ open: props.open, dialog: element(), onOpened: props.onOpened }),
    ({ open, dialog, onOpened }) => {
      if (dialog === undefined) return;
      // Both native calls run on the next turn, not inside this callback. `showModal()` moves
      // focus into the first field and `close()` blurs it, synchronously, and the field's own
      // focus and blur handlers (Formisch's) read and write signals. Done from inside an effect
      // callback those are exactly the reads Solid 2 reports as STRICT_READ_UNTRACKED and the
      // writes whose flush it discards as FLUSH_IN_EFFECT_CALLBACK; a microtask is still before
      // any keystroke, so a caller arming a listener in `onOpened` loses nothing.
      if (open && !dialog.open) {
        queueMicrotask(() => {
          if (dialog.open) return;
          dialog.showModal();
          onOpened?.(dialog);
        });
      }
      if (!open && dialog.open) {
        queueMicrotask(() => {
          if (!dialog.open) return;
          // Ours, not the browser's: the native `close` event fires synchronously from here,
          // and echoing it back to `onClose` calls the caller a second time for a close it
          // asked for. The event is there to catch Escape and the browser's own dismissals.
          ours = true;
          dialog.close();
          ours = false;
        });
      }
    }
  );

  return (
    <dialog
      ref={setElement}
      class={[
        "m-auto max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-surface p-0 text-body ring ring-line backdrop:bg-canvas/75",
        SIZES[props.size ?? "base"],
      ]}
      onCancel={(event) => {
        if (props.beforeClose?.() === false) event.preventDefault();
      }}
      // On the next turn, not inside the event. The browser fires `close` while it is still
      // dismissing the dialog, and a screen's own close handler writes signals: doing that from
      // here is a flush inside the flush that is already running, which Solid 2 says is a no-op.
      onClose={() => (ours ? undefined : queueMicrotask(close))}
    >
      <div class="flex flex-col gap-4 p-6">
        <div class="flex items-start justify-between gap-4">
          {/* `min-w-0` or the title cannot truncate: a flex item refuses to shrink under its own
              content, so the header would grow instead of the text clipping. */}
          <div class="flex min-w-0 flex-col gap-1">
            {/* Titles are built from what a person named a thing: `Delete ${slug}`, `Revoke ${name}`.
                A 64-character username stretched the header off the dialog. */}
            <h2
              class="truncate text-lg font-semibold tracking-tight text-heading"
              title={props.title}
            >
              {props.title}
            </h2>
            <Show when={props.description}>
              <p class="text-base text-muted">{props.description}</p>
            </Show>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close"
            onClick={() => {
              if (props.beforeClose?.() !== false) close();
            }}
          >
            ✕
          </Button>
        </div>
        {props.children}
      </div>
    </dialog>
  );
}

/**
 * The row of buttons that ends a dialog: right-aligned, over a hairline, the confirming action
 * last. Twenty-eight dialogs wrote this row by hand in four different ways.
 */
export function DialogActions(props: { children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-4">
      {props.children}
    </div>
  );
}
