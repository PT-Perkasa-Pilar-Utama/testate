import type { JSX } from "@solidjs/web";

import Button from "./button.tsx";
import Dialog from "./dialog.tsx";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** What the action does, in the words the person needs before they answer. */
  description: string;
  confirmLabel: string;
  /** "Cancel" unless the question makes a better word available: "Keep editing", say. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The destructive confirm every admin action should use. Two of them called window.confirm, so
 * the same screen asked in the browser's voice and in ours depending on which button you pressed.
 */
export default function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onCancel()}
      title={props.title}
      description={props.description}
    >
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => props.onCancel()}>
          {props.cancelLabel ?? "Cancel"}
        </Button>
        <Button variant="destructive" onClick={() => props.onConfirm()}>
          {props.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
