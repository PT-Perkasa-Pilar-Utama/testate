/**
 * The geometry behind `components/line-chart.tsx` (#101): a value axis that ends on a round
 * number, a path that breaks where samples are missing, and the nearest sample to a pointer.
 * Pure, so it is tested without a DOM.
 */

export type ChartPoint = { t: number; v: number };
/** The two validated line colours, `series-1` and `series-2` in `styles/app.css`. */
export type ChartTone = "series-1" | "series-2";

/** The chart draws into this box; the SVG stretches it, and its strokes do not scale. */
export const VIEW_WIDTH = 600;
export const VIEW_HEIGHT = 160;

/** The smallest of 1, 2, 2.5 and 5 times a power of ten at or above `value`; 1 for nothing. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= value) ?? 10;
  return step * power;
}

/** The same, in the unit a byte count reads in (KB, MB, GB are powers of 1024), so the axis
 * ends on 10 MB rather than 9.5 MB. */
export function niceMaxBytes(value: number): number {
  if (!(value >= 1024)) return niceMax(value);
  const unit = 1024 ** Math.floor(Math.log(value) / Math.log(1024));
  return niceMax(value / unit) * unit;
}

export type Scale = { from: number; to: number; max: number };

const x = (t: number, scale: Scale): number =>
  ((t - scale.from) / Math.max(1, scale.to - scale.from)) * VIEW_WIDTH;
const y = (v: number, scale: Scale): number =>
  VIEW_HEIGHT - (Math.min(Math.max(v, 0), scale.max) / scale.max) * VIEW_HEIGHT;

/**
 * An SVG path through the points, lifted wherever two neighbours sit more than two steps apart:
 * a gap in the samples is a gap in the line, never a straight bridge across it.
 */
export function pathOf(points: readonly ChartPoint[], scale: Scale, stepMs: number): string {
  let path = "";
  let previous: ChartPoint | null = null;
  for (const point of points) {
    const move = previous === null || point.t - previous.t > stepMs * 2;
    path += `${move ? "M" : "L"}${x(point.t, scale).toFixed(1)},${y(point.v, scale).toFixed(1)}`;
    previous = point;
  }
  return path;
}

/** The sample nearest to `t`, or null for none. Points are in time order. */
export function nearest(points: readonly ChartPoint[], t: number): ChartPoint | null {
  let best: ChartPoint | null = null;
  for (const point of points) {
    if (best === null || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point;
  }
  return best;
}

/** Where `t` sits across the chart, from 0 to 1. */
export const fractionOf = (t: number, scale: Scale): number =>
  Math.min(1, Math.max(0, x(t, scale) / VIEW_WIDTH));

const DAY_MS = 86_400_000;

/** An axis end: the time within a day, the day and time beyond one. */
export function axisTime(t: number, spanMs: number): string {
  const date = new Date(t);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (spanMs < DAY_MS) return time;
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}
