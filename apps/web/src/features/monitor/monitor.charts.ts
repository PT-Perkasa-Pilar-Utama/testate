/**
 * The monitor's graphs from a series (#101): per adapter, the charts a person reads first. A host
 * shows CPU, load, memory and disk used, the network and each pm2 app; a database server shows
 * each value that moves, with its running totals turned into rates. A value that never changes
 * (the CPU count, the connection limit) is not a graph.
 */
import type { ReadingSeries, ResourceUnit, SeriesLine } from "@testate/shared";

import type { ChartPoint, ChartTone } from "@/lib/chart.ts";
import { formatValue, labelOf } from "./monitor.format.ts";

export type ChartSpec = {
  id: string;
  title: string;
  unit: ResourceUnit;
  max?: number;
  lines: { label: string; tone: ChartTone; points: ChartPoint[] }[];
};
export type AdapterCharts = {
  adapter_id: string;
  name: string;
  source: SeriesLine["source"];
  charts: ChartSpec[];
};

/** Fixed for the life of a host or a server; the latest value says them. */
const STATIC = new Set([
  "cpu_count",
  "memory_total",
  "swap_total",
  "disk_total",
  "max_connections",
  "uptime",
]);
/** Running totals since the server started: the graph is how fast they grow. */
const COUNTERS = new Set(["commits", "rollbacks", "deadlocks", "questions", "slow_queries"]);
/** The host's keys the host charts below draw. */
const HOST_DRAWN = new Set([
  "cpu_percent",
  "cpu_iowait",
  "load_1m",
  "load_5m",
  "load_15m",
  "memory_available",
  "swap_free",
  "disk_free",
  "net_rx",
  "net_tx",
]);

const pointsOf = (line: SeriesLine | undefined): ChartPoint[] =>
  (line?.points ?? []).map((point) => ({ t: Date.parse(point.t), v: point.avg }));

/** `total - free` per bucket both have; the top of the axis is the latest total. */
function usedOf(total: SeriesLine | undefined, free: SeriesLine | undefined): ChartPoint[] {
  const totals = new Map(pointsOf(total).map((point) => [point.t, point.v]));
  return pointsOf(free).flatMap((point) => {
    const all = totals.get(point.t);
    return all === undefined ? [] : [{ t: point.t, v: all - point.v }];
  });
}

/** How much a running total grew per second, bucket to bucket; a restart's drop is left out. */
export function rateOf(points: readonly ChartPoint[]): ChartPoint[] {
  return points.slice(1).flatMap((point, index) => {
    const before = points[index];
    if (before === undefined || point.v < before.v) return [];
    return [{ t: point.t, v: (point.v - before.v) / ((point.t - before.t) / 1000) }];
  });
}

type Lines = Map<string, SeriesLine>;

function hostCharts(lines: Lines): ChartSpec[] {
  const latest = (key: string): number | undefined => lines.get(key)?.points.at(-1)?.avg;
  const charts: ChartSpec[] = [
    {
      id: "cpu",
      title: "CPU",
      unit: "percent",
      max: 100,
      lines: [
        { label: "CPU", tone: "series-1", points: pointsOf(lines.get("cpu_percent")) },
        { label: "I/O wait", tone: "series-2", points: pointsOf(lines.get("cpu_iowait")) },
      ],
    },
    {
      id: "load",
      title: "Load, 1 min",
      unit: "load",
      lines: [{ label: "Load", tone: "series-1", points: pointsOf(lines.get("load_1m")) }],
    },
    {
      id: "memory",
      title: "Memory used",
      unit: "bytes",
      ...maxOf(latest("memory_total")),
      lines: [
        {
          label: "Used",
          tone: "series-1",
          points: usedOf(lines.get("memory_total"), lines.get("memory_available")),
        },
      ],
    },
    {
      id: "disk",
      title: "Disk used",
      unit: "bytes",
      ...maxOf(latest("disk_total")),
      lines: [
        {
          label: "Used",
          tone: "series-1",
          points: usedOf(lines.get("disk_total"), lines.get("disk_free")),
        },
      ],
    },
    {
      id: "network",
      title: "Network",
      unit: "bytes_per_second",
      lines: [
        { label: "Received", tone: "series-1", points: pointsOf(lines.get("net_rx")) },
        { label: "Sent", tone: "series-2", points: pointsOf(lines.get("net_tx")) },
      ],
    },
  ];
  return charts.filter((chart) => chart.lines.some((line) => line.points.length > 0));
}

const maxOf = (value: number | undefined): { max?: number } =>
  value === undefined || value <= 0 ? {} : { max: value };

function appCharts(lines: Lines): ChartSpec[] {
  return [...lines.values()]
    .filter((line) => /^app_.+_(cpu|memory)$/.test(line.key))
    .map((line) => ({
      id: line.key,
      title: labelOf(line.key),
      unit: line.unit,
      lines: [{ label: labelOf(line.key), tone: "series-1" as const, points: pointsOf(line) }],
    }));
}

function otherCharts(lines: Lines, drawn: ReadonlySet<string>): ChartSpec[] {
  return [...lines.values()]
    .filter((line) => !drawn.has(line.key) && !STATIC.has(line.key) && !line.key.startsWith("app_"))
    .map((line) => {
      const counter = COUNTERS.has(line.key);
      const points = counter ? rateOf(pointsOf(line)) : pointsOf(line);
      return {
        id: line.key,
        title: counter ? `${labelOf(line.key)} per second` : labelOf(line.key),
        unit: counter ? "count" : line.unit,
        lines: [{ label: labelOf(line.key), tone: "series-1" as const, points }],
      };
    });
}

/** Every adapter in the series, in its order, with its charts. */
export function chartsOf(series: ReadingSeries): AdapterCharts[] {
  const adapters = new Map<string, { name: string; source: SeriesLine["source"]; lines: Lines }>();
  for (const line of series.lines) {
    const id = `${line.adapter_id}\u0000${line.source}`;
    const entry = adapters.get(id) ?? { name: line.name, source: line.source, lines: new Map() };
    entry.lines.set(line.key, line);
    adapters.set(id, entry);
  }
  return [...adapters.entries()].map(([id, entry]) => ({
    adapter_id: id.split("\u0000")[0] ?? id,
    name: entry.name,
    source: entry.source,
    charts:
      entry.source === "host"
        ? [
            ...hostCharts(entry.lines),
            ...appCharts(entry.lines),
            ...otherCharts(entry.lines, HOST_DRAWN),
          ]
        : otherCharts(entry.lines, new Set()),
  }));
}

/** The axis and tooltip text for a chart's unit. */
export const formatterOf =
  (unit: ResourceUnit) =>
  (value: number): string =>
    formatValue(value, unit);
