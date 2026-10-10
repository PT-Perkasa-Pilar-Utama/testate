import { logsQuerySchema } from "@testate/shared";

import { currentActor } from "../../lib/http/auth.ts";
import { ok, param, parseSingleQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { LogsAnswer, LogsService } from "./logs.service.ts";

export type LogsHandlers = { read: Handler; download: Handler };

type Context = Parameters<Handler>[0];

/** One read, recorded on the request's wide event: what it cost, never a line it returned. */
async function readFor(service: LogsService, c: Context): Promise<LogsAnswer> {
  const query = parseSingleQuery(c, logsQuerySchema);
  const answer = await service.read(
    currentActor(c),
    param(c, "slug"),
    param(c, "id"),
    query,
    c.get("projectScope")
  );
  c.get("event").add("op", {
    logs_source: answer.stats.source,
    logs_files: answer.stats.files,
    logs_bytes: answer.stats.bytes,
    logs_entries: answer.stats.entries,
    logs_cut_by: answer.stats.cutBy ?? "none",
  });
  return answer;
}

export function createLogsHandlers(service: LogsService): LogsHandlers {
  return {
    read: async (c) => ok(c, (await readFor(service, c)).page),
    // The entries on screen as JSON lines, masked exactly as on screen (S3).
    download: async (c) => {
      const answer = await readFor(service, c);
      const lines = answer.page.entries.map((entry) => JSON.stringify(entry)).join("\n");
      const name = `${answer.adapterName}-${answer.stats.source}.jsonl`.replace(/[^\w.-]/g, "_");
      c.header("Content-Type", "application/x-ndjson; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="${name}"`);
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(lines === "" ? "" : `${lines}\n`, 200);
    },
  };
}
