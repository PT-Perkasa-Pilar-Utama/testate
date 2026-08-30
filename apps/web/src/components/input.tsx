import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

// Size and focus strings come from the Kumo registry entry "Input".
export const FIELD_BASE =
  "w-full bg-kumo-control text-kumo-default ring ring-kumo-line outline-none placeholder:text-kumo-placeholder disabled:opacity-50";

export const FIELD_SIZES = {
  sm: "h-7 rounded-md px-2 text-xs",
  base: "h-8 rounded-md px-3 text-base",
  lg: "h-10 rounded-md px-4 text-base",
} as const;

export const FIELD_VARIANTS = {
  default: "focus:ring-kumo-focus focus:ring-2",
  error: "!ring-kumo-danger focus:ring-kumo-danger focus:ring-2",
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
