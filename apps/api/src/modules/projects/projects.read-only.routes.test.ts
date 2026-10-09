import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { JsonObject } from "@testate/shared";

import { errorResponse } from "../../lib/http/index.ts";
import { createHarness } from "../agent/agent.harness.ts";
import type { Harness } from "../agent/agent.harness.ts";
import { createDiffsHandlers } from "../diffs/diffs.handler.ts";
import { createDiffsRouter } from "../diffs/diffs.router.ts";
import { createStatesHandlers } from "../states/states.handler.ts";
import { createStatesRouter } from "../states/states.router.ts";

// #56, Q4 (docs/decisions/2026-10-09-inspect-project.md): the REST routes answer the refusal the
// services raise as a 403 with its own code, not as a generic forbidden or a 500.
const SOME_ID = "01991f00-0000-7000-8000-000000000099";

function appFor(h: Harness): Hono {
  const jobs = h.harness.runtime.jobs;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("actor", h.harness.qa);
    c.set("authKind", "bearer");
    c.set("projectScope", null);
    await next();
  });
  app.route("/", createStatesRouter(createStatesHandlers(h.states, "/api/v1", false, jobs)));
  app.route("/", createDiffsRouter(createDiffsHandlers(h.diffs, "/api/v1", false, jobs)));
  app.onError((cause, c) => errorResponse(c, cause, undefined, false));
  return app;
}

async function post(app: Hono, path: string, sent: JsonObject): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sent),
  });
}

describe("the Inspect project over REST", () => {
  it("answers a snapshot and a diff with 403 PROJECT_READ_ONLY", async () => {
    const h = await createHarness();
    h.harness.db.query("UPDATE projects SET kind = 'inspect' WHERE slug = 'shop'").run();
    const app = appFor(h);
    const snapshot = await post(app, "/projects/shop/states", { name: "in-inspect" });
    const diff = await post(app, "/projects/shop/diffs", {
      base_state_id: SOME_ID,
      target: "live",
    });
    const refused = { error: { code: "PROJECT_READ_ONLY" } };
    expect([snapshot.status, diff.status]).toEqual([403, 403]);
    expect(await snapshot.json()).toMatchObject(refused);
    expect(await diff.json()).toMatchObject(refused);
  });
});
