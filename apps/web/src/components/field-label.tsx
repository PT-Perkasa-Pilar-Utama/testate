import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

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
}): JSX.Element {
  return (
    <span class="flex items-center gap-1.5">
      {props.children}
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
