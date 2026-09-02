import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { StateListItem } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Icon from "@/components/icon.tsx";
import { Truncated } from "@/components/table.tsx";
import { formatWhen } from "@/lib/format.ts";
import { STATE_KIND_LABEL, STATE_STATUS_LABEL } from "@/lib/labels.ts";
import { adapterSummary, eventsLabel, formatBytes } from "./states.format.ts";

const DOT_BASE = "z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-surface";
/** HEAD is the mark's own green, filled, the way the head node reads on the logo. */
const DOT_HEAD = "bg-success";
const DOT_OTHER = "border-2 border-line bg-surface";

/**
 * The dot on the rail, which is also the tick for a comparison when the reader may compare.
 *
 * It used to be a dot beside a checkbox, two boxes on every row for one idea. The dot is now the
 * checkbox itself: `appearance-none` and drawn as the node, a teal ring when ticked, and the same
 * accessible name as before, so nothing that selects "Compare <name>" changes.
 */
function Dot(props: {
  head: boolean;
  name: string;
  picked: boolean;
  onPick?: (() => void) | undefined;
}): JSX.Element {
  return (
    <Show
      when={props.onPick}
      fallback={<span class={[DOT_BASE, props.head ? DOT_HEAD : DOT_OTHER]} aria-hidden="true" />}
    >
      {(pick) => (
        <input
          type="checkbox"
          class={[
            DOT_BASE,
            "cursor-pointer appearance-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            props.head ? DOT_HEAD : DOT_OTHER,
            props.picked ? "!ring-accent" : "",
          ]}
          aria-label={`Compare ${props.name}`}
          title={props.picked ? "Ticked for a comparison" : "Tick to compare"}
          checked={props.picked}
          onChange={() => pick()()}
        />
      )}
    </Show>
  );
}

/** Everything true about a state that is not its name, on one quiet line. */
function Meta(props: { state: StateListItem }): JSX.Element {
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
      {/* What this state produced. A checkout and a diff are events that reference a state, so the
          state is where the count belongs (docs/PROJECT_REWORK.md). */}
      <Show when={eventsLabel(props.state) !== ""}>
        <span aria-hidden="true">·</span>
        <span class="whitespace-nowrap">{eventsLabel(props.state)}</span>
      </Show>
    </div>
  );
}

/** HEAD reads plainly only while the databases are known to hold it (docs/PROJECT_REWORK.md). */
function headLabel(unknown: boolean, dirty: boolean): string {
  if (unknown) return "HEAD, unverified";
  return dirty ? "HEAD · modified" : "HEAD";
}

function headTone(unknown: boolean, dirty: boolean): "warning" | "success" {
  return unknown || dirty ? "warning" : "success";
}

export type TimelineRowProps = {
  state: StateListItem;
  head: boolean;
  headUnknown?: boolean | undefined;
  headDirty?: boolean | undefined;
  /** The row's own controls, so this file never learns what a checkout is. */
  actions: JSX.Element;
  onPick?: ((id: string) => void) | undefined;
  picked?: boolean | undefined;
};

function TimelineRow(props: TimelineRowProps): JSX.Element {
  return (
    <li class="group relative flex gap-3 pb-4 last:pb-0">
      {/*
        The rail runs behind the dots and stops at the last one, so the newest state reads as the
        top of a history rather than as something cut off.
      */}
      {/* `pointer-events-none` because it is a drawn line: without it the rail sits over the
          checkbox beside it and swallows the click. */}
      <span
        class="pointer-events-none absolute top-5 bottom-0 left-[6px] w-px bg-line group-last:hidden"
        aria-hidden="true"
      />
      <Dot
        head={props.head}
        name={props.state.name}
        picked={props.picked === true}
        onPick={props.onPick === undefined ? undefined : () => props.onPick?.(props.state.id)}
      />
      <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <Truncated class="max-w-[20rem] font-medium text-heading">{props.state.name}</Truncated>
            <Show when={props.head}>
              {/* A checkout that failed part way leaves head_status 'unknown': the databases hold
                  some of this state and some of whatever came before, and saying HEAD flat would
                  be a claim nobody checked (docs/PROJECT_REWORK.md). */}
              <Badge variant={headTone(props.headUnknown === true, props.headDirty === true)}>
                {headLabel(props.headUnknown === true, props.headDirty === true)}
              </Badge>
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
  states: readonly StateListItem[];
  /** The state the databases are on right now; null when the project has never been restored. */
  headStateId: string | null;
  /** A failed restore leaves HEAD unknown; the badge says so rather than claiming the state. */
  headUnknown?: boolean;
  /** The databases are known to have moved off HEAD; the badge says modified. */
  headDirty?: boolean;
  actionsFor: (state: StateListItem) => JSX.Element;
  empty: JSX.Element;
  /** Ticking picks a state to compare; absent means the column is not there at all. */
  onPick?: ((id: string) => void) | undefined;
  picked?: readonly string[] | undefined;
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
        <div class="rounded-lg bg-surface px-5 py-8 text-center text-muted ring ring-line">
          {props.empty}
        </div>
      }
    >
      <ul class="grid rounded-lg bg-surface px-5 py-4 ring ring-line" aria-label="States">
        <For each={props.states}>
          {(state) => (
            <TimelineRow
              state={state}
              head={state.id === props.headStateId}
              headUnknown={props.headUnknown === true}
              headDirty={props.headDirty === true}
              actions={props.actionsFor(state)}
              onPick={props.onPick}
              picked={props.picked?.includes(state.id) === true}
            />
          )}
        </For>
      </ul>
    </Show>
  );
}
