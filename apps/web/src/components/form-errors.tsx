import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import type { FieldErrors } from "@/lib/form.ts";
import Banner from "./banner.tsx";

/** What the browser would have said in its own bubble, said here instead. */
export default function FormErrors(props: { errors: FieldErrors }): JSX.Element {
  return (
    <Show when={props.errors.size > 0}>
      <Banner variant="error">
        <ul class="grid gap-1">
          <For each={[...props.errors]}>
            {([label, message]) => (
              <li>
                <span class="font-semibold">{label}:</span> {message}
              </li>
            )}
          </For>
        </ul>
      </Banner>
    </Show>
  );
}
