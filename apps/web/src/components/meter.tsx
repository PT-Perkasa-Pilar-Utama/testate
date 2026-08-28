import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export type MeterProps = {
  /** 0 to `max`. */
  value: number;
  max?: number;
  label?: string;
  /** Text shown at the right end of the label row. */
  detail?: string;
  tone?: "default" | "warning" | "danger";
};

const FILL = {
  default: "bg-kumo-contrast",
  warning: "bg-kumo-warning",
  danger: "bg-kumo-danger",
} as const;

export default function Meter(props: MeterProps): JSX.Element {
  const max = (): number => props.max ?? 1;
  const ratio = (): number => Math.max(0, Math.min(1, max() === 0 ? 0 : props.value / max()));
  return (
    <div class="flex w-full flex-col gap-1">
      <Show when={props.label !== undefined || props.detail !== undefined}>
        <div class="flex items-center justify-between text-xs text-kumo-subtle">
          <span>{props.label}</span>
          <span class="tabular-nums">{props.detail}</span>
        </div>
      </Show>
      <div
        role="meter"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={max()}
        aria-valuenow={props.value}
        class="h-2 w-full overflow-hidden rounded-full bg-kumo-fill"
      >
        <div
          class={["h-full rounded-full transition-[width]", FILL[props.tone ?? "default"]]}
          style={{ width: `${ratio() * 100}%` }}
        />
      </div>
    </div>
  );
}
