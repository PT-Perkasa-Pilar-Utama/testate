import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Icon from "./icon.tsx";
import type { IconName } from "./icon.tsx";

export type EmptyStateProps = {
  icon: IconName;
  /** What is not here, as a noun phrase. "No states yet", not "Empty". */
  title: string;
  /** One sentence saying what to do and where. A person reading this is stuck; unstick them. */
  children: JSX.Element;
  /** The control that ends the emptiness, when the reader is allowed to press it. */
  action?: JSX.Element;
};

/**
 * The nothing-here state, in one place because every screen has one and they were all different.
 *
 * "No items" tells a person only what they already know. Each of these says what the thing is for
 * and where the first one comes from, which is the difference between an empty screen and a dead
 * end.
 */
export default function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class="grid justify-items-center gap-3 rounded-lg px-6 py-10 text-center ring ring-line">
      <span class="grid h-10 w-10 place-items-center rounded-full bg-fill text-muted">
        <Icon name={props.icon} class="h-5 w-5" />
      </span>
      <div class="grid gap-1.5">
        <p class="font-medium text-heading">{props.title}</p>
        <p class="max-w-prose text-muted">{props.children}</p>
      </div>
      <Show when={props.action}>{props.action}</Show>
    </div>
  );
}
