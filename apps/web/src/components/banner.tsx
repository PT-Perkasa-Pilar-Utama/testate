import type { JSX } from "@solidjs/web";

// Strings come from the Kumo registry entry "Banner".
const VARIANTS = {
  default: "bg-kumo-info-tint text-kumo-info ring ring-kumo-info/40",
  alert: "bg-kumo-warning-tint text-kumo-warning ring ring-kumo-warning/40",
  error: "bg-kumo-danger-tint text-kumo-danger ring ring-kumo-danger/40",
  secondary: "bg-kumo-fill text-kumo-subtle ring ring-kumo-line",
} as const;

export type BannerProps = {
  variant?: keyof typeof VARIANTS;
  children: JSX.Element;
};

export default function Banner(props: BannerProps): JSX.Element {
  return (
    <div
      role="status"
      class={[
        "flex w-full items-start gap-3 rounded-md px-4 py-3 text-base",
        VARIANTS[props.variant ?? "default"],
      ]}
    >
      {props.children}
    </div>
  );
}
