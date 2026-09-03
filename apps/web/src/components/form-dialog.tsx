import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

import ConfirmDialog from "./confirm-dialog.tsx";
import Dialog from "./dialog.tsx";
import type { DialogProps } from "./dialog.tsx";

/**
 * A dialog holding a form, which asks before it throws away what someone typed.
 *
 * Every way out is the same way out: Escape, the ✕, and whatever the screen calls Cancel all go
 * through `beforeClose`, so there is one answer to give rather than three places to remember. A
 * form nobody has touched closes without a word; only a form with something in it asks.
 *
 * Touched is measured by listening for the events a person makes, not by comparing values.
 *
 * Comparing was the obvious way and it is wrong twice over. An edit dialog seeds its fields from
 * the row after it opens, so a snapshot taken on opening races that seeding and calls the row's
 * own values a change. And the form store's own dirty check reads a signal per field, which from
 * inside Solid's close path is a read in an effect callback: the thing Solid 2 warns about, forty
 * times over on a screen with three of these. An `input` event is neither. It fires when someone
 * types and stays silent when the form is filled in for them, which is the question being asked.
 */
export default function FormDialog(props: DialogProps): JSX.Element {
  const [asking, setAsking] = createSignal(false);
  let touched = false;
  return (
    <>
      <Dialog
        open={props.open}
        onClose={() => props.onClose()}
        title={props.title}
        description={props.description}
        size={props.size}
        onOpened={(dialog) => {
          touched = false;
          // `once`, so each listener removes itself: the first keystroke is the whole answer, and
          // the next open adds a fresh pair.
          const mark = (): void => {
            touched = true;
          };
          dialog.addEventListener("input", mark, { once: true });
          dialog.addEventListener("change", mark, { once: true });
        }}
        beforeClose={() => {
          if (!touched) return true;
          // Out of the current flush. This runs inside Solid's own close path, and opening a
          // second dialog from there means a write, a nested flush, and the two diagnostics that
          // come with one. A microtask puts the question on the next turn, where it is ordinary.
          queueMicrotask(() => setAsking(true));
          return false;
        }}
      >
        {props.children}
      </Dialog>
      <ConfirmDialog
        open={asking()}
        title="Discard changes?"
        description="Testate has not saved what you typed here yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          touched = false;
          props.onClose();
        }}
      />
    </>
  );
}
