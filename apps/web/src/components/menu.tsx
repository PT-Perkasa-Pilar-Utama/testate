import type { JSX } from "@solidjs/web";

import { buttonClass } from "./button.tsx";

/**
 * A row's overflow menu, built on <details> so the browser owns the toggle, the Escape key and the
 * focus order. Six controls side by side wrapped onto two lines and put a red Delete in front of
 * every row; the one action you usually want stays out here, the rest live in here.
 */
export function Menu(props: { label?: string; children: JSX.Element }): JSX.Element {
  return (
    <details class="relative inline-block">
      <summary
        class={[buttonClass("ghost", "sm"), "list-none"]}
        aria-label={props.label ?? "More actions"}
      >
        ...
      </summary>
      <div class="absolute right-0 z-10 mt-1 grid w-44 gap-0.5 rounded-lg bg-surface p-1 text-left shadow-lg ring ring-line">
        {props.children}
      </div>
    </details>
  );
}

export function MenuItem(props: {
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      class={[
        "cursor-pointer rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
        { "text-danger-fg": props.danger === true },
      ]}
      onClick={(event) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

/** The same row, for the actions that have to be links. */
export function MenuLink(props: { href: string; children: JSX.Element }): JSX.Element {
  return (
    <a
      class="rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
      href={props.href}
      onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
    >
      {props.children}
    </a>
  );
}
