import type { JSX } from "@solidjs/web";

/**
 * The Testate mark: a commit line with a checkout branch off it, the filled node being the state
 * you return to. Same drawing as `docs/assets/logo-mark.svg`, which the README and the homepage
 * use, kept here as markup rather than a file for the same reason `icon.tsx` is markup: the SPA can
 * be served under a sub-path (07 §7.9), and an inline mark has no URL to get wrong.
 *
 * It draws in `currentColor` rather than the file's fixed teal, so it takes the tone of whatever
 * holds it and needs no second copy for a light ground.
 */
export default function Logo(props: { class?: string; label?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 128 128"
      class={["shrink-0", props.class ?? "h-8 w-8"]}
      role={props.label === undefined ? "presentation" : "img"}
      aria-label={props.label}
      aria-hidden={props.label === undefined ? "true" : undefined}
    >
      <g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round">
        <line x1="44" y1="100" x2="44" y2="30" />
        <path d="M44 66 C44 48 84 60 84 42" />
      </g>
      <circle cx="44" cy="100" r="10" fill="currentColor" />
      <circle cx="84" cy="42" r="10" fill="currentColor" />
      {/* The head node reads as the one you are on, the way HEAD does on the states timeline. */}
      <circle cx="44" cy="30" r="14" fill="currentColor" />
      <circle cx="44" cy="30" r="6" class="fill-canvas" />
    </svg>
  );
}
