import type { JSX } from "@solidjs/web";

// Strings come from the Kumo registry entry "Badge".
const BASE =
  "inline-flex w-fit flex-none shrink-0 items-center justify-self-start gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const VARIANTS = {
  primary: "bg-kumo-badge-inverted text-kumo-badge-inverted",
  secondary: "bg-kumo-fill text-kumo-badge-neutral-subtle",
  error: "bg-kumo-danger-tint text-kumo-danger",
  warning: "bg-kumo-warning-tint text-kumo-warning",
  success: "bg-kumo-success-tint text-kumo-success",
  info: "bg-kumo-info-tint text-kumo-info",
  outline: "border border-kumo-fill bg-kumo-base text-kumo-default",
} as const;

export type BadgeProps = {
  variant?: keyof typeof VARIANTS;
  children: JSX.Element;
};

export default function Badge(props: BadgeProps): JSX.Element {
  return <span class={[BASE, VARIANTS[props.variant ?? "secondary"]]}>{props.children}</span>;
}
