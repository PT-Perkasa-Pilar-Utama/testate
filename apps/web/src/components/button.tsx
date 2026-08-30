import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

// Variant and size strings come from the Kumo registry entry "Button".
const BASE =
  "inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-focus disabled:cursor-not-allowed";

// Kumo's React Button sets --kumo-button-emphasis-bg inline; here the emphasis
// colours are the contrast and danger tokens directly.
// Cyan is what you can act on, and it carries near-black: white on it fails AA (ADR 0002).
const VARIANTS = {
  primary:
    "bg-kumo-contrast !text-kumo-inverse ring ring-kumo-contrast not-disabled:hover:bg-kumo-brand-hover disabled:opacity-50",
  secondary:
    "bg-kumo-fill !text-kumo-default ring ring-kumo-line not-disabled:hover:bg-kumo-fill-hover disabled:opacity-50",
  ghost: "text-kumo-default hover:bg-kumo-tint shadow-none bg-inherit",
  success:
    "bg-kumo-success !text-white ring ring-kumo-success not-disabled:hover:opacity-90 disabled:opacity-50",
  destructive:
    "bg-kumo-danger !text-white ring ring-kumo-danger not-disabled:hover:opacity-90 disabled:opacity-50",
  outline: "bg-transparent text-kumo-default ring ring-kumo-line not-disabled:hover:bg-kumo-tint",
} as const;

// 20, 28, 32 and 40 pixels tall: the control heights GitHub uses, all on the 6px radius.
const SIZES = {
  xs: "h-5 gap-1 rounded-md px-1.5 text-xs",
  sm: "h-7 gap-1 rounded-md px-2.5 text-xs",
  base: "h-8 gap-1.5 rounded-md px-3 text-base",
  lg: "h-10 gap-2 rounded-md px-4 text-base",
} as const;

/**
 * The classes a Button renders, for the controls that have to be anchors: a download, an export.
 * Three of those had hand-copied classes that drifted from every size the Button offers, and none
 * of them carried the focus ring.
 */
export function buttonClass(
  variant: keyof typeof VARIANTS = "secondary",
  size: keyof typeof SIZES = "base"
): string {
  return [BASE, VARIANTS[variant], SIZES[size]].join(" ");
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export default function Button(props: ButtonProps): JSX.Element {
  const local = merge({ variant: "secondary", size: "base", type: "button" } as const, props);
  const rest = omit(local, "variant", "size", "class", "children");
  return (
    <button {...rest} class={[BASE, VARIANTS[local.variant], SIZES[local.size], local.class]}>
      {local.children}
    </button>
  );
}
