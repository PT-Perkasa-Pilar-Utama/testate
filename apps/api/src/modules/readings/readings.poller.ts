/**
 * The monitor's timer (#101, docs/decisions/2026-10-11-monitor.md): every
 * `limits.monitor_interval_seconds`, one reading of every project with a readable adapter. The
 * next tick is set when this one ends, so two never overlap. The interval is read each time, so a
 * change in Settings takes effect without a restart; 0 pauses polling.
 */
import type { Logger } from "../../lib/logger/index.ts";
import { reasonOf } from "../../lib/resources/read.ts";
import type { ReadingSources } from "./readings.sources.ts";
import type { ReadingsService } from "./readings.service.ts";

/** How long to wait before looking again while polling is off. */
const PAUSED_MS = 60_000;

export type PollerDeps = {
  readings: Pick<ReadingsService, "poll" | "targets">;
  sources: Pick<ReadingSources, "release" | "closeAll">;
  intervalSeconds: () => Promise<number>;
  logger: Pick<Logger, "create">;
  now: () => Date;
};

export type TickReport = {
  projects: number;
  polled: number;
  values: number;
  unavailable: number;
  failed: number;
  ms: number;
};

export type Poller = {
  start(): void;
  /** Stops the timer, waits for a tick in flight, and closes every kept login. */
  stop(): Promise<void>;
  tick(): Promise<TickReport>;
};

export function createPoller(deps: PollerDeps): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<unknown> = Promise.resolve();
  let stopped = true;

  const tick = async (): Promise<TickReport> => {
    const started = deps.now().getTime();
    const { projectIds, adapterIds } = deps.readings.targets();
    await deps.sources.release(adapterIds);
    const report = { projects: projectIds.length, polled: 0, values: 0, unavailable: 0, failed: 0 };
    const failures: { project_id: string; reason: string }[] = [];
    await Promise.all(
      projectIds.map(async (id) => {
        try {
          const stats = await deps.readings.poll(id);
          if (stats === null) return;
          report.polled += 1;
          report.values += stats.values;
          report.unavailable += stats.unavailable;
        } catch (cause: unknown) {
          report.failed += 1;
          failures.push({ project_id: id, reason: reasonOf(cause) });
        }
      })
    );
    const done = { ...report, ms: deps.now().getTime() - started };
    // A tick with nothing to read writes no line: an instance without hosts stays quiet.
    if (done.polled + done.failed > 0) {
      const event = deps.logger.create("job");
      event.add("op", { name: "monitor", ...done, failures });
      event.emit();
    }
    return done;
  };

  const schedule = async (): Promise<void> => {
    if (stopped) return;
    const seconds = await deps.intervalSeconds().catch(() => 0);
    if (stopped) return;
    timer = setTimeout(
      () => {
        running = next(seconds);
      },
      seconds > 0 ? seconds * 1000 : PAUSED_MS
    );
  };

  /** One tick when polling is on, then the next timer; a failed tick does not stop the timer. */
  const next = async (seconds: number): Promise<void> => {
    try {
      if (seconds > 0) await tick();
    } catch {
      // tick() reports its own failures in its event; only a broken repository lands here.
    }
    await schedule();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void schedule();
    },
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await running;
      await deps.sources.closeAll();
    },
    tick,
  };
}
