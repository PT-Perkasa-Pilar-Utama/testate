import { describe, expect, it } from "bun:test";
import type { Project, Reading, ReadingSeries, SeriesLine } from "@testate/shared";

import { chartsOf, rateOf } from "./monitor.charts.ts";
import { formatValue, labelOf } from "./monitor.format.ts";
import { overviewOf } from "./monitor.overview.ts";

const HOST = "01991f00-0000-7000-8000-000000000031";
const DB = "01991f00-0000-7000-8000-000000000032";
const T0 = "2026-10-11T09:00:00.000Z";
const T1 = "2026-10-11T09:01:00.000Z";

function line(key: string, unit: SeriesLine["unit"], values: number[], adapter = HOST): SeriesLine {
  return {
    adapter_id: adapter,
    name: adapter === HOST ? "app-host" : "orders-db",
    source: adapter === HOST ? "host" : "server",
    key,
    unit,
    points: values.map((avg, index) => ({ t: index === 0 ? T0 : T1, min: avg, avg, max: avg })),
  };
}

const SERIES: ReadingSeries = {
  from: T0,
  to: T1,
  step_seconds: 60,
  lines: [
    line("cpu_percent", "percent", [20, 40]),
    line("cpu_iowait", "percent", [1, 2]),
    line("cpu_count", "count", [4, 4]),
    line("memory_total", "bytes", [8000, 8000]),
    line("memory_available", "bytes", [6000, 5000]),
    line("app_shop_api_0_cpu", "percent", [5, 7]),
    line("app_shop_api_0_uptime", "seconds", [60, 120]),
    line("connections", "count", [3, 5], DB),
    line("max_connections", "count", [100, 100], DB),
    line("commits", "count", [1000, 1600], DB),
  ],
};

describe("the monitor's charts (#101)", () => {
  it("draws CPU with I/O wait, memory used against the total, and each app", () => {
    const [host] = chartsOf(SERIES);
    expect(host?.charts.map((chart) => chart.title)).toEqual([
      "CPU",
      "Memory used",
      "shop_api_0 CPU",
    ]);
    const memory = host?.charts[1];
    expect(memory?.max).toBe(8000);
    expect(memory?.lines[0]?.points.map((point) => point.v)).toEqual([2000, 3000]);
    expect(host?.charts[0]?.lines.map((item) => item.label)).toEqual(["CPU", "I/O wait"]);
  });

  it("draws a server's moving values, its running totals as rates, and leaves out fixed ones", () => {
    const [, server] = chartsOf(SERIES);
    expect(server?.charts.map((chart) => chart.title)).toEqual([
      "Connections",
      "Commits per second",
    ]);
    expect(server?.charts[1]?.lines[0]?.points.map((point) => point.v)).toEqual([10]);
  });

  it("leaves a running total's drop out of its rate, as after a restart", () => {
    const rate = rateOf([
      { t: 0, v: 100 },
      { t: 1000, v: 150 },
      { t: 2000, v: 10 },
      { t: 3000, v: 20 },
    ]);
    expect(rate).toEqual([
      { t: 1000, v: 50 },
      { t: 3000, v: 10 },
    ]);
  });

  it("names a pm2 app's values by the app, and reads the new units", () => {
    expect(labelOf("app_shop_api_0_memory")).toBe("shop_api_0 memory");
    expect(formatValue(42.4, "percent")).toBe("42%");
    expect(formatValue(4.25, "percent")).toBe("4.3%");
    expect(formatValue(2048, "bytes_per_second")).toBe("2.0 KB/s");
  });
});

const PROJECT: Project = {
  id: "01991f00-0000-7000-8000-000000000010",
  slug: "shop",
  kind: "standard",
  name: "Shop",
  description: null,
  quota_bytes: null,
  head: { status: "unknown", state_id: null, state_name: null, changed_at: null, dirty: false },
  created_by: "01991f00-0000-7000-8000-000000000001",
  created_by_label: "admin",
  created_at: T0,
  updated_at: T0,
};

const READING: Reading = {
  id: "01991f00-0000-7000-8000-0000000000d1",
  taken_at: T1,
  source: "poll",
  actor: { kind: "system", label: "Testate" },
  adapters: [
    {
      adapter_id: HOST,
      name: "app-host",
      engine: "sftp",
      source: "host",
      values: [
        { key: "cpu_percent", value: 40, unit: "percent" },
        { key: "memory_total", value: 8000, unit: "bytes" },
        { key: "memory_available", value: 2000, unit: "bytes" },
        { key: "app_shop_api_0_cpu", value: 7, unit: "percent" },
      ],
      unavailable: [{ key: "disk_free", reason: "statvfs not supported" }],
    },
    {
      adapter_id: DB,
      name: "orders-db",
      engine: "postgres",
      source: "server",
      values: [{ key: "connections", value: 5, unit: "count" }],
      unavailable: [],
    },
  ],
};

describe("the Monitor menu (#101)", () => {
  it("lists each host and server from the project's newest reading, unread values as null", () => {
    const overview = overviewOf([
      { project: PROJECT, reading: READING },
      { project: { ...PROJECT, slug: "empty" }, reading: null },
    ]);
    expect(overview.hosts).toEqual([
      expect.objectContaining({ name: "app-host", cpu: 40, memory: 0.75, disk: null, apps: 1 }),
    ]);
    expect(overview.servers).toEqual([
      expect.objectContaining({ name: "orders-db", connections: 5, size: null }),
    ]);
  });
});
