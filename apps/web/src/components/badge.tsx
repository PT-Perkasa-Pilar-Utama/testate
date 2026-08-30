import type { JSX } from "@solidjs/web";

// Strings come from the Kumo registry entry "Badge".
const BASE =
  "inline-flex w-fit flex-none shrink-0 items-center justify-self-start gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const VARIANTS = {
  primary: "bg-kumo-badge-inverted text-kumo-badge-inverted",
  secondary: "bg-kumo-fill text-kumo-badge-neutral-subtle ring ring-kumo-line",
  error: "bg-kumo-danger-tint text-kumo-danger ring ring-kumo-danger/40",
  warning: "bg-kumo-warning-tint text-kumo-warning ring ring-kumo-warning/40",
  success: "bg-kumo-success-tint text-kumo-success ring ring-kumo-success/40",
  info: "bg-kumo-info-tint text-kumo-info ring ring-kumo-info/40",
  outline: "bg-transparent text-kumo-subtle ring ring-kumo-line",
} as const;

export type BadgeProps = {
  variant?: keyof typeof VARIANTS;
  children: JSX.Element;
};

export default function Badge(props: BadgeProps): JSX.Element {
  return <span class={[BASE, VARIANTS[props.variant ?? "secondary"]]}>{props.children}</span>;
}
