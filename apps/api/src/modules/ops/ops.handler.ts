import type { Context } from "hono";

import { ok } from "../../lib/http/index.ts";
import { health } from "./ops.service.ts";
import type { HealthDeps } from "./ops.service.ts";

export type OpsHandlers = {
  health: (c: Context) => Response;
  live: (c: Context) => Response;
  ready: (c: Context) => Response;
};

export function createOpsHandlers(deps: HealthDeps, ready: () => boolean): OpsHandlers {
  return {
    health: (c) => {
      const report = health(deps);
      const actor = c.get("actor");
      const status = report.status === "down" ? 503 : 200;
      if (actor?.role === "admin") return c.json({ data: report }, { status });
      return c.json({ data: { status: report.status } }, { status });
    },
    live: (c) => c.body(null, 204),
    ready: (c) => (ready() ? c.body(null, 204) : c.body(null, 503)),
  };
}

export { ok };
