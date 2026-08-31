import type { JSX } from "@solidjs/web";

// Strings come from the Kumo registry entry "Banner".
const VARIANTS = {
  default: "bg-info-tint text-info-fg ring ring-info/40",
  alert: "bg-warning-tint text-warning-fg ring ring-warning/40",
  error: "bg-danger-tint text-danger-fg ring ring-danger/40",
  secondary: "bg-fill text-muted ring ring-line",
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
