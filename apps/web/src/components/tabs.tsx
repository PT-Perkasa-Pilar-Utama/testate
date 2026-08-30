import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

export type TabItem<T extends string> = { id: T; label: string; count?: number };

export type TabsProps<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
};

/** Kumo "segmented" tabs on native buttons with the tablist roles. */
export default function Tabs<T extends string>(props: TabsProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={props.label}
      class="flex w-full gap-1 overflow-x-auto border-b border-kumo-line"
    >
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === item.id ? "true" : "false"}
            class={[
              "-mb-px inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-3 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-focus",
              {
                "border-kumo-contrast font-semibold text-kumo-strong": props.value === item.id,
                "border-transparent text-kumo-subtle hover:border-kumo-line hover:text-kumo-default":
                  props.value !== item.id,
              },
            ]}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
            <Show when={item.count !== undefined && item.count > 0}>
              <span class="rounded-full bg-kumo-fill px-1.5 text-xs text-kumo-subtle">
                {item.count}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
