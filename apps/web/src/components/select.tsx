import type { ComponentProps, JSX } from "@solidjs/web";
import { For, merge, omit } from "solid-js";

import { FIELD_BASE, FIELD_SIZES, FIELD_VARIANTS } from "./input.tsx";

/** `disabled` greys an option out; say why in its label, since a native option has no hint. */
export type SelectOption<T extends string> = { value: T; label: string; disabled?: boolean };

export type SelectProps<T extends string> = Omit<ComponentProps<"select">, "onChange" | "value"> & {
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: keyof typeof FIELD_SIZES;
};

/** Native select with the shared field styling; the browser supplies the popup and keyboard behaviour. */
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
      <For each={local.options} keyed={(option) => option.value}>
        {(option) => (
          <option
            value={option().value}
            selected={option().value === local.value}
            disabled={option().disabled === true}
          >
            {option().label}
          </option>
        )}
      </For>
    </select>
  );
}
