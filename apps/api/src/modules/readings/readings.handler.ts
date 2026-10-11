import * as v from "valibot";

import { currentActor } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { ReadingsService } from "./readings.service.ts";

export type ReadingsHandlers = { take: Handler; list: Handler; get: Handler };

const LIMIT_DEFAULT = 20;

const listQuery = v.object({
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(100)))
  ),
  cursor: v.optional(v.array(v.pipe(v.string(), v.maxLength(512)))),
});

export function createReadingsHandlers(service: ReadingsService): ReadingsHandlers {
  return {
    take: async (c) => {
      const { reading, stats } = await service.take(currentActor(c), param(c, "slug"));
      c.get("event").add("op", {
        reading_adapters: stats.adapters,
        reading_values: stats.values,
        reading_unavailable: stats.unavailable,
        reading_ms: stats.ms,
      });
      return ok(c, reading, 201);
    },
    list: async (c) => {
      const query = parseQuery(c, listQuery);
      const limit = query.limit?.[0] ?? LIMIT_DEFAULT;
      const page = await service.list(param(c, "slug"), limit, query.cursor?.[0]);
      return okPage(c, page.rows, page.nextCursor, limit);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
  };
}
