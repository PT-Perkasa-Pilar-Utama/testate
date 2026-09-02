import type { JSX } from "@solidjs/web";

import Icon from "./icon.tsx";

/**
 * What a screen shows while it waits: one quiet line with the spinner, in place of the bare
 * paragraph twenty-three screens each wrote for themselves. The children say what is loading.
 */
export default function Pending(props: { children: JSX.Element }): JSX.Element {
  return (
    <p class="flex items-center gap-2 py-1 text-sm text-muted" role="status">
      <Icon name="loader-circle" class="h-3.5 w-3.5 shrink-0 animate-spin" />
      {props.children}
    </p>
  );
}
