import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Icon from "@/components/icon.tsx";
import InspectBadge from "@/components/inspect-badge.tsx";
import { counted } from "@/lib/format.ts";
import { href } from "@/lib/router.ts";
import type { Overview } from "./projects.model.ts";

/**
 * The built-in Inspect project, as a card of its own above the projects table (#56, Q8). It is a
 * utility next to the projects people make rather than one of them, so it never sorts, pages or
 * searches with them.
 */
export default function InspectCard(props: { overview: Overview | null }): JSX.Element {
  return (
    <Show when={props.overview}>
      {(overview) => (
        <a
          class="flex flex-wrap items-start gap-3 rounded-lg bg-surface px-5 py-4 ring ring-line transition-colors duration-[80ms] hover:bg-hover"
          href={href(`/projects/${overview().project.slug}`)}
        >
          <span class="flex h-lh items-center">
            <Icon name="eye" class="h-5 w-5 text-info-fg" />
          </span>
          <span class="grid min-w-0 flex-1 gap-1.5">
            <span class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-heading">{overview().project.name}</span>
              <InspectBadge />
            </span>
            <span class="text-sm text-muted">{overview().project.description}</span>
          </span>
          <span class="text-sm text-muted">
            {counted(overview().adapters.length, "connections")}
          </span>
        </a>
      )}
    </Show>
  );
}
