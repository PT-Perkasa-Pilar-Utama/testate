import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Button from "./button.tsx";
import Icon from "./icon.tsx";

/**
 * Filters, in the shape the reference screens use: a toggle in the header beside the search, and a
 * panel that opens above the table when you want it.
 *
 * Kept shut by default because most visits are not filtered ones, and a row of empty date boxes
 * over every table is a row of the page spent on nothing. The count on the toggle is what makes
 * that safe: a filter left on is the reason a list looks empty, and closing the panel must not
 * hide the fact that one is on.
 */
export function FilterToggle(props: {
  open: boolean;
  active: number;
  onToggle: () => void;
}): JSX.Element {
  return (
    <Button
      variant="secondary"
      aria-expanded={props.open ? "true" : "false"}
      onClick={() => props.onToggle()}
    >
      <Icon name="sliders-horizontal" class="h-4 w-4" />
      Filters
      <Show when={props.active > 0}>
        <span class="rounded-full bg-accent px-1.5 text-xs font-medium text-on-accent">
          {props.active}
        </span>
      </Show>
    </Button>
  );
}

export function FilterPanel(props: { open: boolean; children: JSX.Element }): JSX.Element {
  return (
    <Show when={props.open}>
      <div class="grid gap-3 rounded-lg p-4 ring ring-line sm:grid-cols-2 lg:grid-cols-4">
        {props.children}
      </div>
    </Show>
  );
}

/**
 * One filter and its name. Filters keep their labels: unlike a form field, a date box says nothing
 * about which of four dates it narrows, and "From" alone is not an answer.
 */
export function FilterField(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label class="grid content-start gap-1.5 text-sm">
      <span class="text-muted">{props.label}</span>
      {props.children}
    </label>
  );
}
