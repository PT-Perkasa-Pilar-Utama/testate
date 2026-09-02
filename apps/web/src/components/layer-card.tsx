import type { ComponentProps, JSX } from "@solidjs/web";
import { omit } from "solid-js";

/** A raised surface. Never nest one inside another; put the heading outside the card. */
export default function LayerCard(props: ComponentProps<"section">): JSX.Element {
  const rest = omit(props, "class");
  return <section {...rest} class={["rounded-lg bg-surface p-5 ring ring-line", props.class]} />;
}
