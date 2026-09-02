import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { href, navigate } from "@/lib/router.ts";

export type Crumb = { label: JSX.Element; href?: string | undefined };

/**
 * Where you are, as a path: the homepage's mono label, one slash between levels, the last one
 * plain because it is the page itself. Every level but the last is a link the router answers, so
 * a screen three deep under a project is two clicks from anywhere above it rather than a Back.
 */
export default function Breadcrumbs(props: { items: readonly Crumb[] }): JSX.Element {
  const go = (event: MouseEvent, to: string): void => {
    event.preventDefault();
    navigate(to);
  };
  return (
    <nav aria-label="Breadcrumb">
      <ol class="flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted">
        <For each={props.items}>
          {(item, index) => (
            <li class="flex min-w-0 items-center gap-1.5">
              <Show when={index() > 0}>
                <span aria-hidden="true" class="text-inactive">
                  /
                </span>
              </Show>
              <Show
                when={item.href}
                fallback={
                  <span class="truncate text-body" aria-current="page">
                    {item.label}
                  </span>
                }
              >
                {(to) => (
                  <a
                    class="truncate transition-colors duration-[80ms] hover:text-accent"
                    href={href(to())}
                    onClick={(event) => go(event, to())}
                  >
                    {item.label}
                  </a>
                )}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
}
