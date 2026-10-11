import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";

import {
  axisTime,
  fractionOf,
  nearest,
  niceMax,
  niceMaxBytes,
  pathOf,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "@/lib/chart.ts";
import type { ChartPoint, ChartTone, Scale } from "@/lib/chart.ts";
import { formatWhen } from "@/lib/format.ts";

export type ChartLine = { label: string; tone: ChartTone; points: readonly ChartPoint[] };

export type LineChartProps = {
  title: string;
  lines: readonly ChartLine[];
  from: number;
  to: number;
  /** The bucket width, so a gap of more than two steps lifts the pen. */
  stepMs: number;
  format: (value: number) => string;
  /** A fixed top for the value axis, such as 100 for a percentage; else the data's round max. */
  max?: number;
  /** Round the axis in powers of 1024, for byte counts and byte rates. */
  binary?: boolean;
};

const STROKE = { "series-1": "stroke-series-1", "series-2": "stroke-series-2" } as const;
const KEY = { "series-1": "bg-series-1", "series-2": "bg-series-2" } as const;

/** A short stroke of the series colour: the key for a line, in the legend and the tooltip. */
function LineKey(props: { tone: ChartTone }): JSX.Element {
  return (
    <span aria-hidden="true" class={["inline-block h-0.5 w-3 rounded-full", KEY[props.tone]]} />
  );
}

/**
 * A time series as thin lines on hairline gridlines (#101). One value axis, never two. A
 * crosshair snaps to the nearest bucket and one tooltip lists every line there; the arrow keys
 * walk the same buckets for a keyboard. Two lines or more carry a legend; the latest value of the
 * first line sits beside the title.
 */
export default function LineChart(props: LineChartProps): JSX.Element {
  const scale = createMemo((): Scale => {
    const highest = Math.max(0, ...props.lines.flatMap((line) => line.points.map((p) => p.v)));
    const round = props.binary === true ? niceMaxBytes : niceMax;
    return { from: props.from, to: props.to, max: props.max ?? round(highest) };
  });
  const times = createMemo((): number[] =>
    [...new Set(props.lines.flatMap((line) => line.points.map((point) => point.t)))].sort(
      (a, b) => a - b
    )
  );
  const [at, setAt] = createSignal<number | null>(null);
  const latest = (): ChartPoint | undefined => props.lines[0]?.points.at(-1);
  const empty = (): boolean => times().length === 0;

  const pointAt = (target: HTMLElement, clientX: number): void => {
    const box = target.getBoundingClientRect();
    const fraction = (clientX - box.left) / Math.max(1, box.width);
    const t = props.from + fraction * (props.to - props.from);
    setAt(
      nearest(
        times().map((time) => ({ t: time, v: 0 })),
        t
      )?.t ?? null
    );
  };
  const step = (event: KeyboardEvent): void => {
    const list = times();
    if (list.length === 0 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const current = at();
    const index = current === null ? list.length - 1 : list.indexOf(current);
    const next =
      event.key === "ArrowLeft" ? Math.max(0, index - 1) : Math.min(list.length - 1, index + 1);
    setAt(list[next] ?? null);
  };

  return (
    <section class="grid gap-3 rounded-lg bg-surface px-5 py-4 ring ring-line">
      <header class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 class="text-base font-medium text-heading">{props.title}</h4>
        <Show when={latest()}>
          {(point) => (
            <span class="font-mono text-sm tabular-nums text-body">{props.format(point().v)}</span>
          )}
        </Show>
      </header>
      <Show when={props.lines.length > 1}>
        <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <For each={props.lines}>
            {(line) => (
              <li class="flex items-center gap-1.5">
                <LineKey tone={line.tone} />
                {line.label}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div class="flex h-40 flex-col justify-between text-right font-mono text-xs tabular-nums text-muted">
          <span>{props.format(scale().max)}</span>
          <span>{props.format(scale().max / 2)}</span>
          <span>{props.format(0)}</span>
        </div>
        <div
          class="relative h-40 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          tabindex="0"
          role="img"
          aria-label={`${props.title}, ${axisTime(props.from, props.to - props.from)} to ${axisTime(props.to, props.to - props.from)}`}
          onPointerMove={(event) => pointAt(event.currentTarget, event.clientX)}
          onPointerLeave={() => setAt(null)}
          onKeyDown={step}
          onBlur={() => setAt(null)}
        >
          <svg
            class="absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <For each={[0, VIEW_HEIGHT / 2, VIEW_HEIGHT]}>
              {(y) => (
                <line
                  x1="0"
                  x2={VIEW_WIDTH}
                  y1={y}
                  y2={y}
                  class="stroke-hairline"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
            <For each={props.lines}>
              {(line) => (
                <path
                  d={pathOf(line.points, scale(), props.stepMs)}
                  class={["fill-none", STROKE[line.tone]]}
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
          </svg>
          <Show when={empty()}>
            <p class="absolute inset-0 grid place-items-center text-sm text-muted">
              No samples in this window yet
            </p>
          </Show>
          <Show when={at()}>
            {(t) => (
              <>
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-y-0 w-px bg-line"
                  style={{ left: `${fractionOf(t(), scale()) * 100}%` }}
                />
                <div
                  role="status"
                  class="pointer-events-none absolute top-1 z-10 grid min-w-36 gap-1 rounded-md bg-surface px-3 py-2 text-sm shadow-lg ring ring-line"
                  style={
                    fractionOf(t(), scale()) > 0.6
                      ? { right: `${(1 - fractionOf(t(), scale())) * 100 + 1}%` }
                      : { left: `${fractionOf(t(), scale()) * 100 + 1}%` }
                  }
                >
                  <span class="text-xs text-muted">{formatWhen(new Date(t()).toISOString())}</span>
                  <For each={props.lines}>
                    {(line) => (
                      <span class="flex items-center gap-2">
                        <LineKey tone={line.tone} />
                        <span class="font-mono font-medium tabular-nums text-heading">
                          {valueAt(line.points, t(), props.format)}
                        </span>
                        <Show when={props.lines.length > 1}>
                          <span class="text-muted">{line.label}</span>
                        </Show>
                      </span>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </div>
        <div />
        <div class="mt-1 flex justify-between font-mono text-xs text-muted">
          <span>{axisTime(props.from, props.to - props.from)}</span>
          <span>{axisTime(props.to, props.to - props.from)}</span>
        </div>
      </div>
    </section>
  );
}

function valueAt(
  points: readonly ChartPoint[],
  t: number,
  format: (value: number) => string
): string {
  const point = points.find((item) => item.t === t);
  return point === undefined ? "no sample" : format(point.v);
}
