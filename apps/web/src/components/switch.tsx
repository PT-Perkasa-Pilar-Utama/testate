import type { JSX } from "@solidjs/web";

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

/** Kumo switch size "base" (h-6.5 w-10.5) on a native button with the switch role. */
export default function Switch(props: SwitchProps): JSX.Element {
  return (
    <label class="inline-flex cursor-pointer items-center gap-2 text-base text-kumo-default">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked ? "true" : "false"}
        disabled={props.disabled}
        class={[
          "relative h-6.5 w-10.5 shrink-0 rounded-full ring ring-kumo-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-focus disabled:opacity-50",
          { "bg-kumo-contrast": props.checked, "bg-kumo-fill": !props.checked },
        ]}
        onClick={() => props.onChange(!props.checked)}
      >
        <span
          class={[
            "absolute top-0.5 left-0.5 h-5.5 w-5.5 rounded-full bg-kumo-elevated shadow-sm transition-transform duration-[80ms]",
            { "translate-x-4": props.checked },
          ]}
        />
      </button>
      {props.label}
    </label>
  );
}
