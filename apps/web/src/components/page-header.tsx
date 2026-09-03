import type { JSX } from "@solidjs/web";

import BackLink from "./back-link.tsx";
import { Show, children } from "solid-js";

/**
 * The homepage's small label: mono, spaced, upper-case, teal. Over a page title it says what kind
 * of thing the screen is; over a group of controls it names the group. One place, so the tracking
 * and the size cannot drift between screens.
 */
export function Eyebrow(props: { children: JSX.Element; class?: string }): JSX.Element {
  return (
    <span class={["font-mono text-[11px] tracking-[0.12em] text-accent uppercase", props.class]}>
      {props.children}
    </span>
  );
}

/**
 * The top of a screen: what you are looking at, one line about it, and the action you came to
 * take. Fourteen screens had spelled this out by hand at three different heading sizes.
 */
/*
 * `children()` rather than `<Show when={props.actions}>`: reading a JSX prop inside `when`
 * evaluates the element there, so any signal that element reads is read outside a tracking scope.
 * Solid's dev build reports it as STRICT_READ_UNTRACKED and the block then never updates. This bit
 * as soon as an actions slot held a role-gated control instead of a plain button.
 */
export default function PageHeader(props: {
  title: string;
  /** Where the arrow before the title goes; absent on a top-level screen. */
  back?: { to: string; label: string } | undefined;
  description?: string;
  /** The small mono line over the title: what kind of thing this screen is, or where it sits. */
  eyebrow?: string;
  actions?: JSX.Element;
}): JSX.Element {
  const actions = children(() => props.actions);
  return (
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
      {/* `min-w-0 flex-1` so a long description wraps inside its own column. Without it the title
          block refuses to shrink under its text, the actions have nowhere to sit, and they wrap to
          a row of their own: the tokens screen put its search and its New button on the second
          line while every shorter description kept them in the header. */}
      <div class="grid min-w-0 flex-1 gap-1.5">
        <Show when={props.eyebrow}>
          <Eyebrow>{props.eyebrow}</Eyebrow>
        </Show>
        <h2 class="flex items-center gap-2 text-2xl font-semibold tracking-tight text-heading">
          <Show when={props.back}>
            {(back) => <BackLink to={back().to} label={back().label} />}
          </Show>
          {props.title}
        </h2>
        <Show when={props.description}>
          <p class="text-muted">{props.description}</p>
        </Show>
      </div>
      <Show when={actions()}>
        <div class="flex shrink-0 flex-wrap items-center gap-2">{actions()}</div>
      </Show>
    </div>
  );
}
