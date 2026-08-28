import type { JSX } from "@solidjs/web";

export type KbdProps = { children: JSX.Element };

export default function Kbd(props: KbdProps): JSX.Element {
  return (
    <kbd class="rounded-md bg-kumo-fill px-1.5 py-0.5 font-mono text-xs text-kumo-subtle ring ring-kumo-hairline">
      {props.children}
    </kbd>
  );
}
