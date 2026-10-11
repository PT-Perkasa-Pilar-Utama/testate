/**
 * The two timers that start once the listener is up (22 §22.2 step 10): the daily retention
 * sweep and the monitor's poller (#101). Wiring only.
 */
import { createRetention } from "./boot.ts";
import type { Logger } from "./lib/logger/index.ts";
import type { DiffsService } from "./modules/diffs/diffs.service.ts";
import type { IngestService } from "./modules/ingest/ingest.service.ts";
import type { JobsService } from "./modules/jobs/jobs.service.ts";
import { createPoller } from "./modules/readings/readings.poller.ts";
import type { ReadingSources } from "./modules/readings/readings.sources.ts";
import type { ReadingsService } from "./modules/readings/readings.service.ts";
import type { SettingsService } from "./modules/settings/settings.service.ts";

export type TimerDeps = {
  logger: Logger;
  jobs: Pick<JobsService, "sweep">;
  settings: Pick<SettingsService, "get" | "runRetention">;
  core: { diffs: Pick<DiffsService, "expire"> };
  ingest: Pick<IngestService, "sweep">;
  readings: ReadingsService;
  sources: ReadingSources;
  now: () => Date;
};

export type Timers = { start(): void; stop(): Promise<void> };

export function createTimers(deps: TimerDeps): Timers {
  const { settings, readings } = deps;
  const retention = createRetention(deps.logger, {
    sweepJobs: () => deps.jobs.sweep,
    historyDays: async () => (await settings.get()).retention.job_history_days,
    expireDiffs: () => deps.core.diffs.expire(),
    settings: () => settings.runRetention(),
    ingest: () => deps.ingest.sweep(),
    readings: async (days) =>
      readings.sweep("manual", days) +
      readings.sweep("poll", (await settings.get()).retention.monitor_days),
  });
  const poller = createPoller({
    readings,
    sources: deps.sources,
    intervalSeconds: async () => (await settings.get()).limits.monitor_interval_seconds,
    logger: deps.logger,
    now: deps.now,
  });
  return {
    start() {
      retention.start();
      poller.start();
    },
    async stop() {
      retention.stop();
      await poller.stop();
    },
  };
}
