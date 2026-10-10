import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, untrack } from "solid-js";
import type { LogEntry } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import { buttonClass } from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import JsonView from "@/components/json-view.tsx";
import LoadMore from "@/components/load-more.tsx";
import Pending from "@/components/pending.tsx";
import Select from "@/components/select.tsx";
import { formatWhen, fromLocalInput, toLocalInput } from "@/lib/format.ts";
import { LOG_LEVEL_OPTIONS } from "@/lib/labels.ts";
import { createLogViewer, endNote } from "./logs.viewer.ts";
import type { LogFilters, LogViewer } from "./logs.viewer.ts";
import { labelOf } from "./logs.database.ts";

const LEVEL_TONE = {
  fatal: "error",
  error: "error",
  warn: "warning",
  info: "secondary",
  debug: "outline",
  trace: "outline",
} as const;

function EntryRow(props: { entry: LogEntry }): JSX.Element {
  return (
    <li class="grid gap-1 px-4 py-2.5 sm:grid-cols-[11rem_4.5rem_1fr]">
      <span class="font-mono text-sm text-muted">{formatWhen(props.entry.time)}</span>
      <span>
        <Badge variant={LEVEL_TONE[props.entry.level]}>{props.entry.level}</Badge>
      </span>
      <div class="grid min-w-0 gap-1">
        <pre class="font-mono text-sm break-words whitespace-pre-wrap text-body select-text">
          {props.entry.message}
        </pre>
        <span class="flex flex-wrap items-center gap-2 text-xs text-muted">
          {props.entry.file}
          <Show when={props.entry.masked}>
            <Badge variant="outline">masked</Badge>
          </Show>
        </span>
        <Show when={props.entry.fields}>
          {(fields) => (
            <details class="text-sm">
              <summary class="cursor-pointer text-muted">Fields</summary>
              <JsonView value={fields()} />
            </details>
          )}
        </Show>
      </div>
    </li>
  );
}

function Toolbar(props: { viewer: LogViewer; sources: string[] }): JSX.Element {
  const set = (patch: Partial<LogFilters>): void => props.viewer.setFilters(patch);
  return (
    <div class="grid gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1.5 text-base">
          <span>Source</span>
          <Select
            options={props.sources.map((name) => ({ value: name, label: labelOf(name) }))}
            value={props.viewer.filters().source}
            onChange={(source) => set({ source })}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>Level</span>
          <Select
            options={LOG_LEVEL_OPTIONS}
            value={props.viewer.filters().level}
            onChange={(level) => set({ level })}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>Contains</span>
          <Input
            type="search"
            maxlength="200"
            value={props.viewer.filters().text}
            onChange={(event) => set({ text: event.currentTarget.value })}
          />
        </label>
        <div class="ml-auto flex items-end gap-2">
          <Button
            variant={props.viewer.following() ? "accent" : "secondary"}
            aria-pressed={props.viewer.following() ? "true" : "false"}
            title="Read new lines every 3 seconds"
            onClick={() => props.viewer.toggleFollow()}
          >
            <Icon name={props.viewer.following() ? "loader-circle" : "play"} class="h-4 w-4" />
            {props.viewer.following() ? "Following" : "Follow"}
          </Button>
          <a class={buttonClass("outline")} href={props.viewer.downloadHref()} download>
            <Icon name="download" class="h-4 w-4" />
            Download
          </a>
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1.5 text-base">
          <span>From</span>
          <Input
            type="datetime-local"
            step="1"
            value={toLocalInput(props.viewer.filters().from)}
            onChange={(event) => set({ from: fromLocalInput(event.currentTarget.value) })}
          />
        </label>
        <label class="grid gap-1.5 text-base">
          <span>To</span>
          <Input
            type="datetime-local"
            step="1"
            value={toLocalInput(props.viewer.filters().to)}
            onChange={(event) => set({ to: fromLocalInput(event.currentTarget.value) })}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * One source of a log adapter, newest first (#69): filters, older pages, follow and a download of
 * what is on screen. A viewer reads it masked (Q5); a masked entry says so.
 */
export function LogViewerPanel(props: {
  slug: string;
  adapterId: string;
  /** The adapter's source names, from `GET .../logs/sources`. */
  sources: string[];
}): JSX.Element {
  // Built once per adapter page; an edit that renames a source shows in the picker straight away.
  const viewer = untrack(() =>
    createLogViewer(props.slug, props.adapterId, props.sources, window.location.search)
  );
  const sources = (): string[] => props.sources;
  // An edit that renames or drops the source on screen moves the viewer to the first one left.
  createEffect(
    () => ({ names: sources(), current: viewer.filters().source }),
    ({ names, current }) => {
      if (!names.includes(current)) viewer.setFilters({ source: names[0] ?? "" });
    }
  );
  return (
    <section class="grid gap-4">
      <Toolbar viewer={viewer} sources={sources()} />
      <Show when={viewer.untimed()}>
        <Banner variant="secondary">
          A file here has no timestamps, so its lines are in file order and the window does not
          filter them.
        </Banner>
      </Show>
      <Show when={viewer.error()}>{(message) => <Banner variant="error">{message()}</Banner>}</Show>
      <Show
        when={viewer.entries().length > 0}
        fallback={
          <Show when={!viewer.loading()} fallback={<Pending>Reading the log...</Pending>}>
            <EmptyState icon="file-text" title="No entries">
              Nothing matches these filters in this window.
            </EmptyState>
          </Show>
        }
      >
        <ul class="divide-y divide-hairline rounded-lg bg-surface ring ring-line">
          <For each={viewer.entries()}>{(entry) => <EntryRow entry={entry} />}</For>
        </ul>
        <p class="text-sm text-muted">{endNote(viewer.cutBy(), viewer.more())}</p>
        <LoadMore when={viewer.more()} onMore={() => viewer.older()} />
      </Show>
    </section>
  );
}
