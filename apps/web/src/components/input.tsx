import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

/**
 * Size and focus strings; the focus ring is the accent, as everywhere else.
 *
 * A field you cannot type in used to look exactly like one you can: the slug preview sat beside the
 * name box in the same white-on-control, and the only way to find out was to click it. Both inert
 * states drop to the sunken ground and muted text. `[readonly]` rather than the `read-only:`
 * variant on purpose: `:read-only` matches every `<select>`, which shares this string.
 */
export const FIELD_BASE =
  "w-full bg-control text-body ring ring-line outline-none placeholder:text-placeholder " +
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted " +
  "[&[readonly]]:cursor-default [&[readonly]]:bg-sunken [&[readonly]]:text-muted [&[readonly]]:ring-hairline";

export const FIELD_SIZES = {
  sm: "h-7 rounded-md px-2 text-xs",
  base: "h-8 rounded-md px-3 text-base",
  lg: "h-10 rounded-md px-4 text-base",
} as const;

export const FIELD_VARIANTS = {
  default: "focus:ring-accent focus:ring-2",
  error: "!ring-danger focus:ring-danger focus:ring-2",
} as const;

export type InputProps = ComponentProps<"input"> & {
  size?: keyof typeof FIELD_SIZES;
  variant?: keyof typeof FIELD_VARIANTS;
};

export default function Input(props: InputProps): JSX.Element {
  const local = merge({ size: "base", variant: "default" } as const, props);
  const rest = omit(local, "size", "variant", "class");
  return (
    <input
      {...rest}
      class={[FIELD_BASE, FIELD_SIZES[local.size], FIELD_VARIANTS[local.variant], local.class]}
    />
  );
}
