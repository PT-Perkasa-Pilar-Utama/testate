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

/**
 * What a table says when it holds nothing. Nine screens showed a header row over blank space, which
 * reads like a page that failed to load rather than a project nobody has used yet. The colspan is
 * deliberately larger than any table here: a row that spans everything needs no column count.
 */
export function EmptyRow(props: { children: JSX.Element }): JSX.Element {
  return (
    <tr>
      <td colspan={99} class="px-3 py-10 text-center text-kumo-subtle">
        {props.children}
      </td>
    </tr>
  );
}

export function Cell(props: ComponentProps<"td">): JSX.Element {
  const rest = omit(props, "class");
  return <td {...rest} class={["px-3 py-2 align-top text-kumo-default", props.class]} />;
}
