import { createSignal, onCleanup } from "solid-js";
import type { Reading } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { counted } from "@/lib/format.ts";
import { showToast } from "@/lib/toast.ts";
import { chartsOf } from "./monitor.charts.ts";
import type { AdapterCharts } from "./monitor.charts.ts";
import { monitorModel } from "./monitor.model.ts";

/** Each window and its bucket: no window holds more than 360 points. */
export const RANGES = [
  { id: "15m", label: "15 min", ms: 15 * 60_000, step: 30 },
  { id: "1h", label: "1 h", ms: 3_600_000, step: 60 },
  { id: "6h", label: "6 h", ms: 6 * 3_600_000, step: 300 },
  { id: "24h", label: "24 h", ms: 24 * 3_600_000, step: 900 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 3_600_000, step: 3600 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** The graphs ask again this often while the tab is open, the poller's own default interval. */
const REFRESH_MS = 30_000;

export type MonitorView = { from: number; to: number; stepMs: number; adapters: AdapterCharts[] };

export type MonitorPresenter = {
  range: () => RangeId;
  setRange: (id: RangeId) => void;
  view: Refreshable<MonitorView>;
  latest: Refreshable<Reading | null>;
  taking: () => boolean;
  error: () => string | null;
  take: () => Promise<void>;
};

/** Milliseconds since the epoch, and the bucket in seconds. */
export type TimeWindow = { from: number; to: number; step: number };

export function windowOf(id: RangeId, now: number): TimeWindow {
  const range = RANGES.find((item) => item.id === id) ?? RANGES[1];
  return { from: now - range.ms, to: now, step: range.step };
}

export function createMonitorPresenter(slug: () => string): MonitorPresenter {
  const [range, setRange] = createSignal<RangeId>("1h");
  const view = createRefreshable(async (): Promise<MonitorView> => {
    const window = windowOf(range(), Date.now());
    const series = await monitorModel.series(slug(), {
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
      step: window.step,
    });
    return {
      from: window.from,
      to: window.to,
      stepMs: window.step * 1000,
      adapters: chartsOf(series),
    };
  });
  const latest = createRefreshable(() => monitorModel.latest(slug()));
  const timer = setInterval(() => {
    view.refresh();
    latest.refresh();
  }, REFRESH_MS);
  onCleanup(() => clearInterval(timer));
  const [taking, setTaking] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  return {
    range,
    setRange,
    view,
    latest,
    taking,
    error,
    take: async () => {
      const staticSlug = slug();
      setTaking(true);
      setError(null);
      try {
        const reading = await monitorModel.take(staticSlug);
        const missing = reading.adapters.reduce((sum, item) => sum + item.unavailable.length, 0);
        showToast(
          missing === 0 ? "Sampled" : `Sampled; ${counted(missing, "values")} could not be read`,
          missing === 0 ? "success" : "info"
        );
        view.refresh();
        latest.refresh();
      } catch (cause: unknown) {
        setError(humanMessage(cause, "The sample could not be taken."));
      } finally {
        setTaking(false);
      }
    },
  };
}
