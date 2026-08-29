import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MetadataDb } from "../src/lib/db/index.ts";
import { createLogger } from "../src/lib/logger/index.ts";
import { createDispatcher } from "../src/modules/jobs/jobs.dispatcher.ts";
import type { Dispatcher } from "../src/modules/jobs/jobs.dispatcher.ts";
import { createJobEventHub } from "../src/modules/jobs/jobs.events.ts";
import type { JobEventHub } from "../src/modules/jobs/jobs.events.ts";
import { createJobsRepository } from "../src/modules/jobs/jobs.repository.ts";
import type { JobsRepository } from "../src/modules/jobs/jobs.repository.ts";
import { createJobsService } from "../src/modules/jobs/jobs.service.ts";
import type { JobsService } from "../src/modules/jobs/jobs.service.ts";

export type JobsHarness = {
  jobs: JobsService;
  dispatcher: Dispatcher;
  hub: JobEventHub;
  repo: JobsRepository;
  dataDir: string;
};

/** A jobs runtime on the given database; the dispatcher is created stopped, tests start it. */
export function createJobsHarness(db: MetadataDb, now: () => Date, cap = 2): JobsHarness {
  const dataDir = mkdtempSync(join(tmpdir(), "testate-jobs-"));
  const logger = createLogger({
    dir: join(dataDir, "logs"),
    retentionDays: 1,
    stdout: false,
    service: { name: "testate", version: "test", boot_id: "test", base_path: "/" },
    sampleRate: 1,
    slowMs: 1000,
    stacks: false,
  });
  const repo = createJobsRepository(db);
  const hub = createJobEventHub();
  const dispatcher = createDispatcher({
    repo,
    hub,
    events: logger,
    cap,
    tickMs: 20,
    progressMs: 5,
    now,
  });
  const jobs = createJobsService({ repo, hub, dispatcher, db, dataDir, now, heartbeatMs: 50 });
  return { jobs, dispatcher, hub, repo, dataDir };
}
