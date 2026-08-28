import type { JSX } from "@solidjs/web";

// Strings come from the Kumo registry entry "Banner".
const VARIANTS = {
  default: "bg-kumo-info-tint text-kumo-info",
  alert: "bg-kumo-warning-tint text-kumo-warning",
  error: "bg-kumo-danger-tint text-kumo-danger",
  secondary: "bg-kumo-contrast/5 text-kumo-default/70",
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
        "flex w-full items-start gap-3 rounded-lg px-4 py-3 text-base",
        VARIANTS[props.variant ?? "default"],
      ]}
    >
      {props.children}
    </div>
  );
}
