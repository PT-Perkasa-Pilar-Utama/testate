import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

export type TabItem<T extends string> = { id: T; label: string; count?: number };

export type TabsProps<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /**
   * "underline" is the page's own navigation, the way GitHub marks the section you are in.
   * "segmented" is a control inside a screen, where a second underline row would compete with it.
   */
  variant?: "underline" | "segmented";
};

/** Kumo "segmented" tabs on native buttons with the tablist roles. */
export default function Tabs<T extends string>(props: TabsProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={props.label}
      class={[
        "flex overflow-x-auto",
        props.variant === "segmented"
          ? "w-fit gap-0.5 rounded-md bg-fill p-0.5 ring ring-line"
          : "w-full gap-1 border-b border-line",
      ]}
    >
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === item.id ? "true" : "false"}
            class={[
              "inline-flex cursor-pointer items-center gap-1.5 px-3 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              props.variant === "segmented"
                ? "h-7 rounded-sm"
                : "-mb-px h-9 rounded-t-md border-b-2",
              {
                "border-accent font-semibold text-heading":
                  props.value === item.id && props.variant !== "segmented",
                "bg-surface font-semibold text-heading":
                  props.value === item.id && props.variant === "segmented",
                "border-transparent text-muted hover:text-body": props.value !== item.id,
                "hover:border-line": props.value !== item.id && props.variant !== "segmented",
              },
            ]}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
            <Show when={item.count !== undefined && item.count > 0}>
              <span class="rounded-full bg-fill px-1.5 text-xs text-muted">{item.count}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
