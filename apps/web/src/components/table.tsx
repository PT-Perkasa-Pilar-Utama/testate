import type { ComponentProps, JSX } from "@solidjs/web";
import { Show, omit } from "solid-js";

/**
 * The table shell, in the shape shadcn's data table settled on: a toolbar over a bordered table,
 * a sticky header, a row that lifts under the pointer, one full-width row when there is nothing,
 * and a footer that says how much you are looking at and gets you the next page.
 *
 * Its parts are separate so a screen can leave out what it does not need, which every screen here
 * does: only some of them filter, only some of them page.
 */
export function Table(props: ComponentProps<"table">): JSX.Element {
  const rest = omit(props, "class");
  return (
    <div class="w-full overflow-x-auto overflow-y-auto rounded-lg ring ring-kumo-line">
      <table {...rest} class={["w-full border-collapse text-base", props.class]} />
    </div>
  );
}

/** Controls that belong to the table below them: a filter on the left, an action on the right. */
export function TableToolbar(props: { children: JSX.Element; actions?: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-wrap items-end gap-2">{props.children}</div>
      <Show when={props.actions}>
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      </Show>
    </div>
  );
}

/**
 * What you are looking at, and the way to the rest of it. A keyset list cannot say "page 3 of 40"
 * without counting rows nobody asked it to count, so it says what it holds and offers the next
 * page, which is the honest half of shadcn's pagination bar.
 */
export function TableFooter(props: {
  shown: number;
  noun: string;
  hasMore?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-kumo-subtle">
      <span>
        {props.shown} {props.noun}
        {props.hasMore === true ? " so far" : ""}
      </span>
      <Show when={props.children}>
        <div class="flex items-center gap-2">{props.children}</div>
      </Show>
    </div>
  );
}

export function Head(props: ComponentProps<"th"> & { numeric?: boolean }): JSX.Element {
  const rest = omit(props, "class", "numeric");
  return (
    <th
      {...rest}
      class={[
        "sticky top-0 z-10 h-10 border-b border-kumo-hairline bg-kumo-elevated px-4 align-middle text-xs font-medium whitespace-nowrap text-kumo-subtle",
        props.numeric === true ? "text-right" : "text-left",
        props.class,
      ]}
    />
  );
}

export function Row(props: ComponentProps<"tr">): JSX.Element {
  const rest = omit(props, "class");
  // A line between rows, not a stripe: the row you point at is the one that lifts.
  return (
    <tr
      {...rest}
      class={["border-b border-kumo-hairline last:border-0 hover:bg-kumo-tint", props.class]}
    />
  );
}

/**
 * What a table says when it holds nothing. Nine screens showed a header row over blank space, which
 * reads like a page that failed to load rather than a project nobody has used yet. The colspan is
 * deliberately larger than any table here: a row that spans everything needs no column count.
 */
export function EmptyRow(props: { children: JSX.Element }): JSX.Element {
  return (
    <tr>
      <td colspan={99} class="h-24 px-4 py-8 text-center align-middle text-kumo-subtle">
        {props.children}
      </td>
    </tr>
  );
}

export function Cell(props: ComponentProps<"td"> & { numeric?: boolean }): JSX.Element {
  const rest = omit(props, "class", "numeric");
  return (
    <td
      {...rest}
      class={[
        "px-4 py-2.5 align-middle text-kumo-default",
        props.numeric === true ? "text-right tabular-nums whitespace-nowrap" : "",
        props.class,
      ]}
    />
  );
}
