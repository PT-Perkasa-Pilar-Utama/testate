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
      class="inline-flex gap-0.5 rounded-lg bg-kumo-fill p-0.5"
    >
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === item.id ? "true" : "false"}
            class={[
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus",
              {
                "bg-kumo-base text-kumo-strong shadow-sm": props.value === item.id,
                "text-kumo-subtle hover:text-kumo-default": props.value !== item.id,
              },
            ]}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
            <Show when={item.count !== undefined && item.count > 0}>
              <span class="rounded-full bg-kumo-tint px-1.5 text-xs text-kumo-subtle">
                {item.count}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
