import type { JSX } from "@solidjs/web";
import { Show, children, createSignal } from "solid-js";

import { buttonClass } from "./button.tsx";
import Icon from "./icon.tsx";

/** Which corner the panel hangs from: a row's menu drops, the rail's identity rises. */
export type MenuPlace = "below-right" | "above-left";

const GAP = 4;
const EDGE = 8;

/**
 * Puts the panel beside its trigger, in viewport coordinates.
 *
 * A popover lives in the top layer, so it is positioned against the viewport rather than against
 * anything it sits inside. That is the whole point here: the panel used to be an absolutely
 * positioned child of the table, and the table scrolls, so the menu was clipped at the table's
 * edge with half of "Disable" cut off.
 */
function place(trigger: HTMLElement, panel: HTMLElement, at: MenuPlace): void {
  const rect = trigger.getBoundingClientRect();
  const wanted =
    at === "above-left"
      ? { top: rect.top - panel.offsetHeight - GAP, left: rect.left }
      : { top: rect.bottom + GAP, left: rect.right - panel.offsetWidth };
  const top = Math.min(Math.max(wanted.top, EDGE), window.innerHeight - panel.offsetHeight - EDGE);
  const left = Math.min(Math.max(wanted.left, EDGE), window.innerWidth - panel.offsetWidth - EDGE);
  panel.style.top = `${Math.max(EDGE, top)}px`;
  panel.style.left = `${Math.max(EDGE, left)}px`;
}

/**
 * The actions that do not fit in a row, and the row's own identity menu in the rail.
 *
 * `popover="auto"` rather than the `<details>` this used to be, and it buys three things the old
 * one got wrong: the panel renders in the top layer so a scrolling table cannot clip it, the
 * browser closes it when you click away, and only one auto popover is open at a time, so two rows
 * can no longer show their menus over each other.
 */
export function Menu(props: {
  label?: string;
  /** The control that opens it; the ellipsis button when a screen does not say otherwise. */
  trigger?: JSX.Element;
  place?: MenuPlace;
  panelClass?: string;
  children: JSX.Element;
}): JSX.Element {
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  const [button, setButton] = createSignal<HTMLButtonElement>();
  // See page-header.tsx: a JSX prop read inside `when` is read outside a tracking scope.
  const trigger = children(() => props.trigger);
  const open = (): void => {
    const box = panel();
    const anchor = button();
    if (box === undefined || anchor === undefined) return;
    box.showPopover();
    place(anchor, box, props.place ?? "below-right");
  };
  return (
    <>
      <button
        ref={setButton}
        type="button"
        class={trigger() === undefined ? [buttonClass("ghost", "sm"), "cursor-pointer"] : "w-full"}
        aria-haspopup="menu"
        aria-label={props.label ?? "More actions"}
        onClick={() => open()}
      >
        <Show when={trigger()} fallback={<Icon name="ellipsis" />}>
          {trigger()}
        </Show>
      </button>
      {/* No `display` utility on the popover itself. A closed popover is hidden by the UA rule
          `[popover]:not(:popover-open) { display: none }`, and any class that sets display beats
          it: with `grid` here the panel was laid out over the page at all times, swallowing the
          click on the very button meant to open it. The grid lives one level in. */}
      <div
        ref={setPanel}
        popover="auto"
        class={[
          "fixed inset-auto m-0 rounded-lg bg-surface p-1 text-left shadow-lg ring ring-line",
          props.panelClass ?? "w-44",
        ]}
      >
        <div class="grid gap-0.5">{props.children}</div>
      </div>
    </>
  );
}

/** Shuts the panel this control sits in, whichever kind it is. */
function close(from: Element): void {
  const panel = from.closest("[popover]");
  if (panel instanceof HTMLElement && panel.matches(":popover-open")) panel.hidePopover();
}

export function MenuItem(props: {
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Why a disabled item is disabled. A control that cannot be used has to say so. */
  title?: string | undefined;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      title={props.title}
      class={[
        "cursor-pointer rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
        { "text-danger-fg": props.danger === true },
      ]}
      onClick={(event) => {
        close(event.currentTarget);
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
      onClick={(event) => close(event.currentTarget)}
    >
      {props.children}
    </a>
  );
}
