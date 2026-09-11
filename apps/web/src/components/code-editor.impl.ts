import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import type { CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { languageOf } from "./code-editor.language.ts";
import type { EditorLanguage } from "./code-editor.language.ts";

/**
 * Everything of CodeMirror's, behind one dynamic import: the SPA's chunk stays the size it was and
 * this one arrives with the first console a person opens.
 */

/** The console's colours are the design tokens, read at paint time so the light theme remaps them. */
const THEME = EditorView.theme({
  "&": { backgroundColor: "var(--color-sunken)", color: "var(--color-body)", fontSize: "0.875rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-content": { padding: "0.5rem 0", caretColor: "var(--color-body)" },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-cursor": { borderLeftColor: "var(--color-body)" },
  ".cm-placeholder": { color: "var(--color-placeholder)" },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 25%, transparent)",
  },
  ".cm-matchingBracket": { outline: "1px solid var(--color-accent)", borderRadius: "2px" },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-body)",
    border: "1px solid var(--color-line)",
    borderRadius: "8px",
    fontFamily: "var(--font-mono)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-fill-hover)",
    color: "var(--color-body)",
  },
  ".cm-completionDetail": { color: "var(--color-muted)", fontStyle: "normal" },
});

const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--color-accent)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--color-success-fg)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-warning-fg)" },
  { tag: tags.comment, color: "var(--color-muted)", fontStyle: "italic" },
  { tag: [tags.propertyName, tags.typeName], color: "var(--color-info-fg)" },
  { tag: tags.operator, color: "var(--color-muted)" },
]);

/** 0.875rem at line-height 1.5, so `rows` means what it does on a textarea. */
export const LINE_REM = 1.3125;

export type MountOptions = {
  label: string;
  hint: string;
  rows: number;
  onInput: (text: string) => void;
};

export type EditorHandle = {
  /** Replaces the document unless it already reads so; the caret stays where it is otherwise. */
  setValue: (text: string) => void;
  setLanguage: (spec: EditorLanguage) => void;
  destroy: () => void;
};

function completer(source: CompletionSource | undefined): ReturnType<typeof autocompletion> {
  return autocompletion(source === undefined ? {} : { override: [source] });
}

export function mount(parent: HTMLElement, options: MountOptions): EditorHandle {
  const language = new Compartment();
  const completions = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [
        history(),
        closeBrackets(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        syntaxHighlighting(HIGHLIGHT),
        THEME,
        EditorView.theme({ ".cm-content": { minHeight: `${options.rows * LINE_REM}rem` } }),
        EditorView.lineWrapping,
        // A contenteditable has no placeholder attribute; the ARIA one carries the hint instead.
        EditorView.contentAttributes.of({
          "aria-label": options.label,
          "aria-placeholder": options.hint,
        }),
        placeholder(options.hint),
        language.of([]),
        completions.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onInput(update.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    setValue: (text) => {
      if (view.state.doc.toString() === text) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setLanguage: (spec) => {
      const built = languageOf(spec);
      view.dispatch({
        effects: [
          language.reconfigure(built.support),
          completions.reconfigure(completer(built.completions)),
        ],
      });
    },
    destroy: () => view.destroy(),
  };
}
