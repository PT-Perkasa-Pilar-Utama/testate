import type { ComponentProps, JSX } from "@solidjs/web";
import { omit } from "solid-js";

/**
 * The homepage's card grid: cells separated by one-pixel lines rather than gaps, inside one
 * rounded edge. The lines are the grid's own background showing through, which is why a cell
 * must paint itself and why there is no gap to tune per screen.
 */
export function LineGrid(props: ComponentProps<"div">): JSX.Element {
  const rest = omit(props, "class");
  return (
    <div
      {...rest}
      class={["grid gap-px overflow-hidden rounded-lg bg-line ring ring-line", props.class]}
    />
  );
}

/** One cell of a `LineGrid`. */
export function LineCell(props: ComponentProps<"div">): JSX.Element {
  const rest = omit(props, "class");
  return <div {...rest} class={["bg-surface", props.class]} />;
}

/** A number and what it counts, the way the homepage sets its stats: mono, light, tabular. */
export function Stat(props: { label: string; value: string }): JSX.Element {
  return (
    <LineCell class="grid content-start gap-1 px-5 py-4">
      <span class="font-mono text-3xl font-light tracking-tight tabular-nums text-heading">
        {props.value}
      </span>
      <span class="text-sm text-muted">{props.label}</span>
    </LineCell>
  );
}
