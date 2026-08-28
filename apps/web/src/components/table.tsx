import type { ComponentProps, JSX } from "@solidjs/web";
import { omit } from "solid-js";

// Row striping comes from the Kumo registry entry "Table" (variant "default").

export function Table(props: ComponentProps<"table">): JSX.Element {
  const rest = omit(props, "class");
  return (
    <div class="w-full overflow-x-auto rounded-lg ring ring-kumo-line">
      <table {...rest} class={["w-full border-collapse text-base", props.class]} />
    </div>
  );
}

export function Head(props: ComponentProps<"th">): JSX.Element {
  const rest = omit(props, "class");
  return (
    <th
      {...rest}
      class={["bg-kumo-tint px-3 py-2 text-left text-xs font-medium text-kumo-subtle", props.class]}
    />
  );
}

export function Row(props: ComponentProps<"tr">): JSX.Element {
  const rest = omit(props, "class");
  return <tr {...rest} class={["even:bg-kumo-tint", props.class]} />;
}

export function Cell(props: ComponentProps<"td">): JSX.Element {
  const rest = omit(props, "class");
  return <td {...rest} class={["px-3 py-2 align-top text-kumo-default", props.class]} />;
}
