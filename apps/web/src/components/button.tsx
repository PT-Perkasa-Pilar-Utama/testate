import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

// Variant and size strings; the emphasis variant is the one solid control on a screen.
const BASE =
  "inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap select-none outline-none transition-colors duration-[80ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed";

// The homepage's hierarchy: the one thing to do is solid ink on the ground, everything else is a
// line. Teal is kept for what is active or focused, not for buttons, so a screen with six of them
// has one you look at first.
const VARIANTS = {
  primary: "bg-body !text-inverse ring ring-body not-disabled:hover:opacity-90 disabled:opacity-50",
  secondary:
    "bg-fill !text-body ring ring-line not-disabled:hover:bg-fill-hover not-disabled:hover:ring-inactive disabled:opacity-50",
  ghost: "text-muted hover:bg-hover hover:text-body shadow-none bg-inherit",
  success:
    "bg-success !text-white ring ring-success not-disabled:hover:opacity-90 disabled:opacity-50",
  destructive:
    "bg-danger !text-white ring ring-danger not-disabled:hover:opacity-90 disabled:opacity-50",
  outline:
    "bg-transparent text-body ring ring-line not-disabled:hover:bg-hover not-disabled:hover:ring-inactive",
  // The product's own two verbs, take a state and check one out, and nothing else: the one solid
  // teal on a screen is the thing Testate exists to do.
  accent:
    "bg-accent !text-on-accent ring ring-accent not-disabled:hover:bg-accent-hover disabled:opacity-50",
  // The verb on the state the databases already hold: still there, tinted, never the loud one.
  "accent-outline":
    "bg-accent/10 text-accent ring ring-accent/40 not-disabled:hover:bg-accent/20 disabled:opacity-50",
  // A destructive action that sits in a row or a header, where a solid red on every line would
  // shout. The confirm dialog that follows it carries the solid one.
  danger:
    "bg-transparent !text-danger-fg ring ring-line not-disabled:hover:bg-danger-tint not-disabled:hover:ring-danger/60 disabled:opacity-50",
} as const;

// 20, 28, 32 and 40 pixels tall, all on the 8px radius.
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
