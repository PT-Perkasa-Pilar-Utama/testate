import type { ComponentProps, JSX } from "@solidjs/web";
import { Show, children, omit } from "solid-js";

import Icon from "./icon.tsx";
import Input from "./input.tsx";
import { counted } from "@/lib/format.ts";
import { directionOf } from "@/lib/table.ts";
import type { Direction, SortControl } from "@/lib/table.ts";

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
    <div class="w-full overflow-x-auto overflow-y-auto rounded-lg bg-surface ring ring-line">
      <table {...rest} class={["w-full border-collapse text-base", props.class]} />
    </div>
  );
}

/** Controls that belong to the table below them: a filter on the left, an action on the right. */
export function TableToolbar(props: { children: JSX.Element; actions?: JSX.Element }): JSX.Element {
  // See the note in page-header.tsx: a JSX prop read inside `when` is read outside tracking.
  const actions = children(() => props.actions);
  return (
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-wrap items-end gap-2">{props.children}</div>
      <Show when={actions()}>
        <div class="flex flex-wrap items-center gap-2">{actions()}</div>
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
  /** How many match across every page. Null where the endpoint does not count. */
  total?: number | null;
  children?: JSX.Element;
}): JSX.Element {
  // See the note in page-header.tsx: a JSX prop read inside `when` is read outside tracking.
  const extra = children(() => props.children);
  // "12 of 340" only when the two differ: "340 of 340" is a worse way of writing "340".
  const count = (): string => {
    const total = props.total;
    if (total === undefined || total === null) return counted(props.shown, props.noun);
    return total === props.shown
      ? counted(total, props.noun)
      : `${props.shown} of ${counted(total, props.noun)}`;
  };
  const trailing = (): string => (props.hasMore === true && props.total == null ? " so far" : "");
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-muted">
      <span>
        {count()}
        {trailing()}
      </span>
      <Show when={extra()}>
        <div class="flex items-center gap-2">{extra()}</div>
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
// No standing z-index: every frozen cell is positioned, so they paint in row order. A row menu used
// to need this cell lifted above the next row's, and no longer does: the menu is a popover, drawn
// in the top layer above the whole page rather than inside this cell's stacking context.
const PINNED_CELL =
  "sticky right-0 bg-surface group-hover:bg-hover shadow-[inset_1px_0_0_0_var(--color-hairline)]";

export function Head(
  props: ComponentProps<"th"> & { numeric?: boolean; pinned?: boolean }
): JSX.Element {
  const rest = omit(props, "class", "numeric", "pinned");
  return (
    <th
      {...rest}
      class={[
        "sticky top-0 z-10 h-9 border-b border-line bg-surface px-4 align-middle font-mono text-[11px] font-normal tracking-[0.08em] whitespace-nowrap text-muted uppercase",
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

/**
 * One line per row unless the cell asks otherwise. A project called
 * `somelong-really-long-project-name` used to wrap to four lines and take the whole row with it,
 * which pushed every other row out of the window. The table already scrolls sideways, so a value
 * too wide for its column costs a scroll rather than the shape of the list. `wrap` is for the cells
 * that really are paragraphs: an error message, a query, a diff value.
 */
export function Cell(
  props: ComponentProps<"td"> & { numeric?: boolean; pinned?: boolean; wrap?: boolean }
): JSX.Element {
  const rest = omit(props, "class", "numeric", "pinned", "wrap");
  return (
    <td
      {...rest}
      class={[
        "px-4 py-2.5 align-middle text-body",
        props.wrap === true ? "" : "whitespace-nowrap",
        props.numeric === true ? "text-right tabular-nums" : "",
        props.pinned === true ? PINNED_CELL : "",
        props.class,
      ]}
    />
  );
}

/**
 * A value that has no length limit: an id, a path, a name someone typed. It stops at the width of
 * its column and the whole thing is one hover away, rather than every row paying for the longest.
 */
export function Truncated(props: { children: string; class?: string }): JSX.Element {
  return (
    <span class={["block truncate", props.class ?? "max-w-[18rem]"]} title={props.children}>
      {props.children}
    </span>
  );
}

const SORT_ARROW = { asc: "chevron-up", desc: "chevron-down" } as const;
const SORT_LABEL = { asc: "ascending", desc: "descending" } as const;

/**
 * A column you can order the table by. The arrow says which way it points and `aria-sort` says the
 * same thing to a screen reader; a column nobody has clicked shows the pair of arrows, which is how
 * you tell "sortable" from "sorted".
 */
export function SortHead(props: {
  direction: Direction | null;
  onSort: () => void;
  numeric?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Head
      numeric={props.numeric === true}
      aria-sort={props.direction === null ? "none" : SORT_LABEL[props.direction]}
    >
      <button
        type="button"
        class={[
          "-mx-2 inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-hover hover:text-body",
          props.numeric === true ? "flex-row-reverse" : "",
        ]}
        onClick={() => props.onSort()}
      >
        {props.children}
        <Icon
          name={props.direction === null ? "arrow-up-down" : SORT_ARROW[props.direction]}
          class="h-3 w-3"
        />
      </button>
    </Head>
  );
}

/**
 * One sortable column, wired to the screen's table view. Every list that sorts writes the same
 * line, which is the point: the header, the arrow and the `aria-sort` cannot drift apart per screen.
 */
export function SortColumn<TKey extends string>(props: {
  view: SortControl<TKey>;
  column: TKey;
  numeric?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <SortHead
      direction={directionOf(props.view.sort(), props.column)}
      onSort={() => props.view.toggleSort(props.column)}
      numeric={props.numeric === true}
    >
      {props.children}
    </SortHead>
  );
}

/**
 * The search box, in the header beside the screen's own action.
 *
 * No label above it: a magnifier and "Search jobs..." say what it is, and the label was buying a
 * whole row of the page for one narrow field. The placeholder is the accessible name, so it has to
 * name what is being searched rather than say "Search".
 */
export function TableSearch(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <div class="relative">
      <Icon
        name="search"
        class="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        class="w-64 pl-8"
        aria-label={props.placeholder}
        value={props.value}
        placeholder={props.placeholder}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}
