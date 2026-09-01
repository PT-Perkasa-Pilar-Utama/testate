import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { State } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Icon from "@/components/icon.tsx";
import { Truncated } from "@/components/table.tsx";
import { formatWhen } from "@/lib/format.ts";
import { STATE_KIND_LABEL, STATE_STATUS_LABEL } from "@/lib/labels.ts";
import { adapterSummary, formatBytes } from "./states.format.ts";

/**
 * The dot on the rail. HEAD is filled and cyan, the way the current commit reads on a graph;
 * everything else is a hollow ring, so the eye finds where the databases are without reading.
 */
function Dot(props: { head: boolean }): JSX.Element {
  return (
    <span
      class={[
        "z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full ring-4 ring-canvas",
        props.head ? "bg-accent" : "border-2 border-line bg-canvas",
      ]}
      aria-hidden="true"
    />
  );
}

/** Everything true about a state that is not its name, on one quiet line. */
function Meta(props: { state: State }): JSX.Element {
  return (
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>{STATE_KIND_LABEL[props.state.kind]}</span>
      <span aria-hidden="true">·</span>
      {/* Both truncate: the adapter list already caps itself at two names plus a count, but
          either of those two names, or the actor's own name, is still free text with no ceiling. */}
      <Truncated class="max-w-[12rem]">{adapterSummary(props.state.adapters)}</Truncated>
      <Show when={props.state.size_bytes > 0}>
        <span aria-hidden="true">·</span>
        <span class="tabular-nums">{formatBytes(props.state.size_bytes)}</span>
      </Show>
      <span aria-hidden="true">·</span>
      <Truncated class="max-w-[10rem]">{props.state.actor.label}</Truncated>
      <span aria-hidden="true">·</span>
      <span class="whitespace-nowrap tabular-nums">{formatWhen(props.state.created_at)}</span>
    </div>
  );
}

export type TimelineRowProps = {
  state: State;
  head: boolean;
  /** The row's own controls, so this file never learns what a checkout is. */
  actions: JSX.Element;
};

function TimelineRow(props: TimelineRowProps): JSX.Element {
  return (
    <li class="group relative flex gap-3 pb-4 last:pb-0">
      {/*
        The rail runs behind the dots and stops at the last one, so the newest state reads as the
        top of a history rather than as something cut off.
      */}
      <span
        class="absolute top-5 bottom-0 left-1.5 w-px bg-line group-last:hidden"
        aria-hidden="true"
      />
      <Dot head={props.head} />
      <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <Truncated class="max-w-[20rem] font-medium text-heading">{props.state.name}</Truncated>
            <Show when={props.head}>
              <Badge variant="primary">HEAD</Badge>
            </Show>
            <Show when={props.state.protected}>
              <Badge variant="outline">
                <Icon name="lock" class="h-3 w-3" />
                protected
              </Badge>
            </Show>
            <Show when={props.state.status !== "ready"}>
              <Badge variant={props.state.status === "failed" ? "error" : "warning"}>
                {STATE_STATUS_LABEL[props.state.status]}
              </Badge>
            </Show>
            {/* Tags are how a person finds one state among fifty; the table that came before
                showed them and the timeline must not quietly drop them. */}
            <For each={props.state.tags}>
              {(tag) => (
                <Badge variant="info">
                  <span class="block max-w-[8rem] truncate" title={tag}>
                    {tag}
                  </span>
                </Badge>
              )}
            </For>
          </div>
          <Meta state={props.state} />
        </div>
        <div class="flex shrink-0 items-center gap-1">{props.actions}</div>
      </div>
    </li>
  );
}

export type TimelineProps = {
  states: readonly State[];
  /** The state the databases are on right now; null when the project has never been restored. */
  headStateId: string | null;
  actionsFor: (state: State) => JSX.Element;
  empty: JSX.Element;
};

/**
 * States as a history, newest first, in place of the table this used to be.
 *
 * A table asked a tester to read seven columns to answer one question: which state am I on, and
 * how do I get back to another. The rail answers the first and every row carries the second.
 */
export default function Timeline(props: TimelineProps): JSX.Element {
  return (
    <Show
      when={props.states.length > 0}
      fallback={
        <div class="rounded-lg px-5 py-8 text-center text-muted ring ring-line">{props.empty}</div>
      }
    >
      <ul class="grid rounded-lg px-5 py-4 ring ring-line" aria-label="States">
        <For each={props.states}>
          {(state) => (
            <TimelineRow
              state={state}
              head={state.id === props.headStateId}
              actions={props.actionsFor(state)}
            />
          )}
        </For>
      </ul>
    </Show>
  );
}
