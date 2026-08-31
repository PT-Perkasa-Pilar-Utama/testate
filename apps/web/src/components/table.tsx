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
    <div class="w-full overflow-x-auto overflow-y-auto rounded-lg ring ring-line">
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
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
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

/**
 * `pinned` freezes a column against the right edge while the table scrolls sideways. It exists for
 * the action column: a row's Edit and Delete are the reason you scrolled to that row, and losing
 * them off-screen means scrolling back to act on what you just found.
 *
 * A frozen cell needs its own background, or the columns it covers show through. It therefore also
 * needs to follow the row's hover, which is why `Row` is a `group`.
 */
const PINNED_HEAD = "sticky right-0 z-20 bg-surface shadow-[inset_1px_0_0_0_var(--color-hairline)]";
// No standing z-index: every frozen cell is positioned, so they paint in row order, and a row menu
// opening downwards would be covered by the next row's frozen cell, which swallows the click on
// its items. The cell lifts itself only while its own menu is open, which `<details open>` says.
const PINNED_CELL =
  "sticky right-0 bg-canvas group-hover:bg-hover has-[details[open]]:z-30 shadow-[inset_1px_0_0_0_var(--color-hairline)]";

export function Head(
  props: ComponentProps<"th"> & { numeric?: boolean; pinned?: boolean }
): JSX.Element {
  const rest = omit(props, "class", "numeric", "pinned");
  return (
    <th
      {...rest}
      class={[
        "sticky top-0 z-10 h-10 border-b border-hairline bg-surface px-4 align-middle text-xs font-medium whitespace-nowrap text-muted",
        props.numeric === true ? "text-right" : "text-left",
        props.pinned === true ? PINNED_HEAD : "",
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
      class={["group border-b border-hairline last:border-0 hover:bg-hover", props.class]}
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
      <td colspan={99} class="h-24 px-4 py-8 text-center align-middle text-muted">
        {props.children}
      </td>
    </tr>
  );
}

export function Cell(
  props: ComponentProps<"td"> & { numeric?: boolean; pinned?: boolean }
): JSX.Element {
  const rest = omit(props, "class", "numeric", "pinned");
  return (
    <td
      {...rest}
      class={[
        "px-4 py-2.5 align-middle text-body",
        props.numeric === true ? "text-right tabular-nums whitespace-nowrap" : "",
        props.pinned === true ? PINNED_CELL : "",
        props.class,
      ]}
    />
  );
}
