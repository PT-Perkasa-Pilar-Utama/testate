import type { JSX } from "@solidjs/web";
import { Show, children } from "solid-js";

/**
 * The top of a screen: what you are looking at, one line about it, and the action you came to
 * take. Fourteen screens had spelled this out by hand at three different heading sizes.
 */
/*
 * `children()` rather than `<Show when={props.actions}>`: reading a JSX prop inside `when`
 * evaluates the element there, so any signal that element reads is read outside a tracking scope.
 * Solid's dev build reports it as STRICT_READ_UNTRACKED and the block then never updates. This bit
 * as soon as an actions slot held a role-gated control instead of a plain button.
 */
export default function PageHeader(props: {
  title: string;
  description?: string;
  actions?: JSX.Element;
}): JSX.Element {
  const actions = children(() => props.actions);
  return (
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div class="grid gap-1.5">
        <h2 class="text-xl font-semibold text-heading">{props.title}</h2>
        <Show when={props.description}>
          <p class="text-muted">{props.description}</p>
        </Show>
      </div>
      <Show when={actions()}>
        <div class="flex flex-wrap items-center gap-2">{actions()}</div>
      </Show>
    </div>
  );
}
