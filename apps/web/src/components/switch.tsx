import type { JSX } from "@solidjs/web";

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

/** A switch (h-5.5 w-9.5) on a native button with the switch role; the text is the parent's size. */
export default function Switch(props: SwitchProps): JSX.Element {
  return (
    <label class="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-body">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked ? "true" : "false"}
        disabled={props.disabled}
        class={[
          "relative h-5.5 w-9.5 shrink-0 rounded-full ring ring-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50",
          { "bg-accent": props.checked, "bg-fill": !props.checked },
        ]}
        onClick={() => props.onChange(!props.checked)}
      >
        <span
          class={[
            "absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full shadow-sm transition-transform duration-[80ms]",
            { "translate-x-4 bg-canvas": props.checked, "bg-muted": !props.checked },
          ]}
        />
      </button>
      {props.label}
    </label>
  );
}
