import type { JSX } from "@solidjs/web";

// One pill per tone; each is the fill, tint and foreground of one status token trio.
const BASE =
  "inline-flex w-fit flex-none shrink-0 items-center justify-self-start gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const VARIANTS = {
  primary: "bg-accent text-on-accent",
  secondary: "bg-fill text-muted ring ring-line",
  error: "bg-danger-tint text-danger-fg ring ring-danger/40",
  warning: "bg-warning-tint text-warning-fg ring ring-warning/40",
  success: "bg-success-tint text-success-fg ring ring-success/40",
  info: "bg-info-tint text-info-fg ring ring-info/40",
  outline: "bg-transparent text-muted ring ring-line",
} as const;

export type BadgeProps = {
  variant?: keyof typeof VARIANTS;
  children: JSX.Element;
};

export default function Badge(props: BadgeProps): JSX.Element {
  return <span class={[BASE, VARIANTS[props.variant ?? "secondary"]]}>{props.children}</span>;
}
