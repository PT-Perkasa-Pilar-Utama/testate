import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Icon from "@/components/icon.tsx";
import type { IconName } from "@/components/icon.tsx";

/**
 * One column of the browser, the shape every level shares: a titled head, a scrolling list, an
 * optional foot. Fixed width so a path of columns scrolls sideways, the way the Firestore
 * console does, rather than squeezing every level thinner as one opens.
 */
export function Column(props: {
  title: string;
  icon: IconName;
  children: JSX.Element;
  foot?: JSX.Element;
  /** The last column takes what is left, so a document's fields have room to read. */
  last?: boolean | undefined;
}): JSX.Element {
  return (
    <section
      class={[
        "flex min-h-[28rem] flex-col",
        props.last === true ? "min-w-72 flex-1" : "w-72 shrink-0",
      ]}
      aria-label={props.title}
    >
      {/* A label, not a heading: the section carries the name, and the page keeps its one h1. */}
      <div class="flex items-center gap-2 border-b border-line px-3 py-2.5 text-sm font-medium text-heading">
        <Icon name={props.icon} class="h-3.5 w-3.5 shrink-0 text-muted" />
        <span class="truncate">{props.title}</span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">{props.children}</div>
      <Show when={props.foot}>
        <div class="border-t border-line px-3 py-2">{props.foot}</div>
      </Show>
    </section>
  );
}

/** A row in a column: what it is called, and a chevron when it opens the next column. */
export function Item(props: {
  label: string;
  selected: boolean;
  opens: boolean;
  mono?: boolean | undefined;
  onClick: () => void;
  /** Rendered before the label: a value beside a key, say. */
  detail?: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      class={[
        "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-sm hover:bg-fill",
        props.selected
          ? "border-accent bg-accent/15 font-medium text-heading"
          : "border-transparent text-body",
        props.mono === true ? "font-mono" : "",
      ]}
      aria-current={props.selected ? "true" : undefined}
      onClick={() => props.onClick()}
    >
      <span class="min-w-0 flex-1 truncate">
        {props.label}
        {props.detail}
      </span>
      <Show when={props.opens}>
        <Icon name="chevron-right" class="h-3.5 w-3.5 shrink-0 text-muted" />
      </Show>
    </button>
  );
}

export function Empty(props: { children: JSX.Element }): JSX.Element {
  return <p class="px-3 py-6 text-center text-sm text-muted">{props.children}</p>;
}
