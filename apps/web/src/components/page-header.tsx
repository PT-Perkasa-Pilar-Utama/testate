import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

/**
 * The top of a screen: what you are looking at, one line about it, and the action you came to
 * take. Fourteen screens had spelled this out by hand at three different heading sizes.
 */
export default function PageHeader(props: {
  title: string;
  description?: string;
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-kumo-line pb-4">
      <div class="grid gap-1.5">
        <h2 class="text-xl font-semibold text-kumo-strong">{props.title}</h2>
        <Show when={props.description}>
          <p class="text-kumo-subtle">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      </Show>
    </div>
  );
}
