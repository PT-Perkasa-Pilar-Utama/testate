import type { JSX } from "@solidjs/web";

/**
 * A choice from a short ladder, not a free number.
 *
 * A quota typed as a number invites 7.3 GiB, which nobody means and everybody has to read later.
 * The steps are the values worth choosing, and the ends of the ladder stay on screen so the middle
 * has a scale to sit against. It is the platform's own range input: keyboard, touch and the
 * viewer's accent colour come with it rather than being rebuilt.
 */
export default function Slider(props: {
  label: string;
  steps: readonly string[];
  /** Short forms for the two ends, so a long current value does not push them onto a second line. */
  ends: readonly [string, string];
  index: number;
  onIndex: (index: number) => void;
}): JSX.Element {
  const at = (index: number): string => props.steps[index] ?? "";
  return (
    <div class="grid gap-1.5">
      <input
        type="range"
        class="w-full accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        min="0"
        max={props.steps.length - 1}
        step="1"
        value={props.index}
        aria-label={props.label}
        aria-valuetext={at(props.index)}
        onInput={(event) => props.onIndex(Number(event.currentTarget.value))}
      />
      <div class="flex items-center justify-between gap-3 text-xs whitespace-nowrap text-muted">
        <span>{props.ends[0]}</span>
        <span class="font-medium text-body">{at(props.index)}</span>
        <span>{props.ends[1]}</span>
      </div>
    </div>
  );
}
