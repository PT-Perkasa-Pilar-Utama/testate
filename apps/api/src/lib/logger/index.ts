import type { MiddlewareHandler } from "hono";

import { WideEvent } from "./event.ts";
import type { EventKind, Fields, WideEventRecord } from "./event.ts";
import { FileSink } from "./sink.ts";
import type { SinkOptions } from "./sink.ts";

export { WideEvent, RedactionError } from "./event.ts";
export type { EmitMeta, EventKind, Fields, Section, WideEventRecord } from "./event.ts";
export { FileSink } from "./sink.ts";

export type LoggerOptions = SinkOptions & {
  service: { name: string; version: string; boot_id: string; base_path: string };
  sampleRate: number;
  slowMs: number;
  stacks: boolean;
};

export type Logger = {
  create(kind: EventKind): WideEvent;
  middleware(): MiddlewareHandler;
  sink: FileSink;
  options: LoggerOptions;
};

/** Tail sampling: keep every warn and error, every job, every slow request, and a share of the rest. */
function shouldKeep(record: WideEventRecord, options: LoggerOptions): boolean {
  if (record.level !== "info") return true;
  if (record.kind !== "request") return true;
  if (record.durationMs !== null && record.durationMs >= options.slowMs) return true;
  return Math.random() < options.sampleRate;
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = new FileSink(options);
  let dropped = 0;

  const write = (record: WideEventRecord): void => {
    if (!shouldKeep(record, options)) {
      dropped += 1;
      return;
    }
    const service: Fields = {
      ...options.service,
      sink_degraded: sink.degraded,
      dropped_since_boot: dropped,
    };
    sink.write({ ...record, sections: { ...record.sections, service } });
  };

  const create = (kind: EventKind): WideEvent => new WideEvent(kind, write);

  const middleware = (): MiddlewareHandler => async (c, next) => {
    const event = create("request");
    c.set("event", event);
    const requestId = c.req.header("x-request-id") ?? Bun.randomUUIDv7();
    c.set("requestId", requestId);
    try {
      await next();
    } finally {
      const durationMs = Math.round(performance.now() - event.startedAt);
      event.merge("request", {
        id: requestId,
        method: c.req.method,
        path: c.req.path,
        route: c.req.routePath,
        status: c.res.status,
        duration_ms: durationMs,
        user_agent: c.req.header("user-agent") ?? null,
      });
      c.res.headers.set("X-Request-Id", requestId);
      event.emit({ status: c.res.status, durationMs });
    }
  };

  return { create, middleware, sink, options };
}
