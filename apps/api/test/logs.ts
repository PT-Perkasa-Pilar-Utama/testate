import type { AdapterDraft } from "@testate/shared";

import { createServerLogReader } from "../src/modules/logs/logs.server.ts";
import type { LogsDeps } from "../src/modules/logs/logs.service.ts";
import type { AdaptersHarness } from "./adapters.ts";

/** A `logfile` adapter over the harness's in-memory SFTP host: a pm2 app's logs (#69). */
export const PM2_LOGS: AdapterDraft = {
  kind: "logs",
  engine: "logfile",
  name: "api-logs",
  config: {
    transport: "sftp",
    host: "logs.sit.internal",
    user: "deploy",
    root_path: "/home/deploy",
    sources: [{ name: "api", glob: ".pm2/logs/api-*.log", format: "pm2" }],
  },
  secrets: { password: "deploy-secret" },
};

/** The logs service's deps over the adapters harness: remote files and ingested lines. */
export function logsDepsOf(harness: AdaptersHarness): LogsDeps {
  return {
    projects: harness.projectsRepo,
    files: harness.files,
    adapters: harness.repo,
    ingest: harness.ingest,
    serverLogs: createServerLogReader({ engines: harness.engines, ring: harness.ring }),
  };
}
