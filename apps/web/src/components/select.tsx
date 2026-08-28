import type { ComponentProps, JSX } from "@solidjs/web";
import { For, merge, omit } from "solid-js";

import { FIELD_BASE, FIELD_SIZES, FIELD_VARIANTS } from "./input.tsx";

export type SelectOption<T extends string> = { value: T; label: string };

export type SelectProps<T extends string> = Omit<ComponentProps<"select">, "onChange" | "value"> & {
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: keyof typeof FIELD_SIZES;
};

/** Native select with Kumo field styling; the browser supplies the popup and keyboard behaviour. */
export default function Select<T extends string>(props: SelectProps<T>): JSX.Element {
  const local = merge({ size: "base" } as const, props);
  const rest = omit(local, "options", "value", "onChange", "size", "class");
  const pick = (raw: string): void => {
    const option = local.options.find((candidate) => candidate.value === raw);
    if (option !== undefined) local.onChange(option.value);
  };
  return (
    <select
      {...rest}
      class={[
        FIELD_BASE,
        FIELD_SIZES[local.size],
        FIELD_VARIANTS.default,
        "cursor-pointer",
        local.class,
      ]}
      value={local.value}
      onChange={(event) => pick(event.currentTarget.value)}
    >
      <For each={local.options}>
        {(option) => (
          <option value={option.value} selected={option.value === local.value}>
            {option.label}
          </option>
        )}
      </For>
    </select>
  );
}
