import type { JSX } from "@solidjs/web";
import { Show, createSignal } from "solid-js";

import Icon from "./icon.tsx";

/**
 * A field's label, saying whether you have to fill it in.
 *
 * Every field was unmarked, so the only way to learn that a description was optional was to submit
 * without one. Both states are marked rather than only one: "unmarked" is not a signal a person can
 * read, and a form where half the fields are required either way leaves them counting.
 *
 * The marker is drawn by CSS rather than written into the label, and that is not a style choice.
 * These labels wrap their control, so everything inside them is the control's accessible name: an
 * asterisk in the markup turns "Bucket" into "Bucket*" for a screen reader and for every test that
 * asks for a field by name. `required` on the input carries the fact to assistive technology, and
 * this carries it to the eye.
 */
export default function FieldLabel(props: {
  children: JSX.Element;
  required: boolean;
  /** One sentence for a rule the name cannot carry, behind a (?) beside it. */
  help?: string | undefined;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <span class="flex flex-wrap items-center gap-1.5">
      {props.children}
      <Show when={props.help}>
        {(text) => (
          <>
            {/* Not a <button>: a label names the first labelable element inside it, and a button
                before the input would take the name away from the input. A span with the role
                keeps the label on the control and still opens on click, Enter, or Space. */}
            <span
              role="button"
              tabindex="0"
              class="inline-flex cursor-pointer text-muted hover:text-heading"
              title={text()}
              aria-label={open() ? "Hide the hint" : "Show the hint"}
              aria-expanded={open() ? "true" : "false"}
              onClick={(event) => {
                event.preventDefault();
                setOpen((value) => !value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setOpen((value) => !value);
              }}
            >
              <Icon name="circle-question-mark" class="h-3.5 w-3.5" />
            </span>
            <Show when={open()}>
              <span class="basis-full text-xs font-normal text-muted">{text()}</span>
            </Show>
          </>
        )}
      </Show>
      <Show
        when={props.required}
        fallback={
          <span
            aria-hidden="true"
            class="text-xs font-normal text-muted after:content-['optional']"
          />
        }
      >
        <span aria-hidden="true" class="text-danger-fg after:content-['*']" title="Required" />
      </Show>
    </span>
  );
}
