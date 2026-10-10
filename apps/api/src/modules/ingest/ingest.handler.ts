import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { AppError, ok, param, rateLimited } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import type { IngestService } from "./ingest.service.ts";

export type IngestHandlers = { push: Handler; rotate: Handler; clear: Handler };

/**
 * A refused token is charged to its address at the anonymous rate, as a request with no
 * credential is (07 §7.5): `/ingest` is out of that budget, so a stranger cannot spend an
 * adapter's own budget, and guessing tokens is not free either.
 */
const REFUSED_PER_MINUTE = 120;

export function createIngestHandlers(
  service: IngestService,
  trustProxy: boolean,
  now: () => Date
): IngestHandlers {
  const refused = createRateLimiter(now);
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    push: async (c) => {
      const header = c.req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const adapterId = param(c, "id");
      // The token first: a refused push never has its body read.
      const adapter = await service.authorize(token, adapterId).catch((cause: unknown) => {
        if (cause instanceof AppError && cause.code === "UNAUTHORIZED") {
          const wait = refused.hit(meta(c).ip ?? "unknown", REFUSED_PER_MINUTE);
          if (wait !== null) throw rateLimited(wait);
        }
        throw cause;
      });
      const answer = await service.write(adapter, await c.req.text());
      // What the push cost, never a line of it (21).
      c.get("event").add("op", {
        ingest_adapter: adapterId,
        ingest_lines: answer.accepted,
        ingest_malformed: answer.malformed,
      });
      return ok(c, answer, 202);
    },
    rotate: async (c) =>
      ok(
        c,
        service.rotate(
          currentActor(c),
          param(c, "slug"),
          param(c, "id"),
          c.get("projectScope"),
          meta(c)
        )
      ),
    clear: async (c) => {
      await service.clear(
        currentActor(c),
        param(c, "slug"),
        param(c, "id"),
        c.get("projectScope"),
        meta(c)
      );
      return ok(c, { cleared: true });
    },
  };
}
