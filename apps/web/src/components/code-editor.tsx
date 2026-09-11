import type { JSX } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";

import type { EditorHandle } from "./code-editor.impl.ts";
import type { EditorLanguage } from "./code-editor.language.ts";

export type { EditorLanguage } from "./code-editor.language.ts";

export type CodeEditorProps = {
  value: string;
  onInput: (text: string) => void;
  /** What the editor speaks, as data; the language objects are built inside the loaded chunk. */
  language: EditorLanguage;
  "aria-label": string;
  placeholder?: string;
  rows?: number;
  class?: string;
};

/** 0.875rem at line-height 1.5, so `rows` means what it does on a textarea. */
const LINE_REM = 1.3125;

/**
 * A CodeMirror 6 editor in the shape of `InputArea`: a value in, a text out, the field ring
 * around it. CodeMirror itself is a dynamic import, so the SPA's own chunk stays the size it was
 * and the editor's arrives with the first console a person opens; until then the box is empty
 * and the right height.
 */
export default function CodeEditor(props: CodeEditorProps): JSX.Element {
  const [element, setElement] = createSignal<HTMLDivElement>();
  const [editor, setEditor] = createSignal<EditorHandle>();
  // Taken in a compute, as `dialog.tsx` takes `onClose`: a prop read inside an effect callback is
  // the untracked read Solid 2 warns about.
  let emit: (text: string) => void = () => undefined;
  createEffect(
    () => props.onInput,
    (handler) => {
      emit = handler;
    }
  );

  // Built once per mount with an empty document. The value and the language arrive through the
  // effects below, so a keystroke or a schema never rebuilds it.
  createEffect(
    () => ({
      parent: element(),
      label: props["aria-label"],
      hint: props.placeholder ?? "",
      rows: props.rows ?? 6,
    }),
    ({ parent, label, hint, rows }) => {
      if (parent === undefined) return;
      let live = true;
      let handle: EditorHandle | undefined;
      const open = async (): Promise<void> => {
        const { mount } = await import("./code-editor.impl.ts");
        if (!live) return;
        handle = mount(parent, { label, hint, rows, onInput: (text) => emit(text) });
        setEditor(handle);
      };
      void open();
      return () => {
        live = false;
        handle?.destroy();
        setEditor(undefined);
      };
    }
  );

  // A value set from outside (Sample, a saved query, history) replaces the document. A value that
  // came from the editor itself is already there and is left alone, or the caret would jump.
  createEffect(
    () => ({ handle: editor(), value: props.value }),
    ({ handle, value }) => handle?.setValue(value)
  );

  createEffect(
    () => ({ handle: editor(), spec: props.language }),
    ({ handle, spec }) => handle?.setLanguage(spec)
  );

  return (
    <div
      ref={setElement}
      style={{ "min-height": `${(props.rows ?? 6) * LINE_REM + 1}rem` }}
      class={[
        "w-full overflow-hidden rounded-lg bg-sunken ring ring-line focus-within:ring-2 focus-within:ring-accent",
        props.class,
      ]}
    />
  );
}
