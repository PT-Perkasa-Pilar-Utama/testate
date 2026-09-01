import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

/**
 * One field's own message, under the field it belongs to.
 *
 * The app used to collect every message into a banner at the top of the form, which made a person
 * read a list and then hunt for the box it named. A message belongs beside the control, and the
 * control turns red with it (`Input`'s `error` variant).
 */
export default function FieldError(props: { message?: string | undefined }): JSX.Element {
  return (
    <Show when={props.message}>
      {(message) => (
        <p class="text-sm text-danger-fg" role="alert">
          {message()}
        </p>
      )}
    </Show>
  );
}
