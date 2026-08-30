import type { ComponentProps, JSX } from "@solidjs/web";
import { omit } from "solid-js";

/** A raised surface, the Kumo "LayerCard" container. */
export default function LayerCard(props: ComponentProps<"section">): JSX.Element {
  const rest = omit(props, "class");
  return (
    <section
      {...rest}
      class={["rounded-lg bg-kumo-elevated p-4 ring ring-kumo-line", props.class]}
    />
  );
}
