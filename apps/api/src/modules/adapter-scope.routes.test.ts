import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Actor } from "@testate/shared";

import { errorResponse, notFound } from "../lib/http/index.ts";
import { createDataHandlers } from "./data/data.handler.ts";
import { createDataRouter } from "./data/data.router.ts";
import type { DataService } from "./data/data.service.ts";
import { createImportsHandlers } from "./imports/imports.handler.ts";
import { createImportsRouter } from "./imports/imports.router.ts";
import type { ImportsService } from "./imports/imports.service.ts";

const ACTOR: Actor = {
  kind: "user",
  id: "01a05e00-0000-7000-8000-000000000001",
  label: "someone",
  role: "admin",
  agent: false,
};

type GuardState = { checked: number; handled: number };

function dataService(state: GuardState): DataService {
  // SAFETY: the proxy supplies every service method used by these route tests; only the guard and
  // schema methods have behavior, while all other methods are unreachable from the request.
  return new Proxy({} as DataService, {
    get: (_target, key: string) => {
      if (key === "assertAdapter") {
        return () => {
          state.checked += 1;
          throw notFound("adapter");
        };
      }
      if (key === "schema") {
        return async () => {
          state.handled += 1;
          return [];
        };
      }
      return async () => [];
    },
  });
}

function importsService(state: GuardState): ImportsService {
  // SAFETY: the proxy supplies every service method used by these route tests; only the guard and
  // normalizer-list methods have behavior, while all other methods are unreachable from the request.
  return new Proxy({} as ImportsService, {
    get: (_target, key: string) => {
      if (key === "assertAdapter") {
        return () => {
          state.checked += 1;
          throw notFound("adapter");
        };
      }
      if (key === "listNormalizers") {
        return async () => {
          state.handled += 1;
          return [];
        };
      }
      return async () => [];
    },
  });
}

function appWith(router: Hono, actor: Actor | null): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    c.set("authKind", "session");
    c.set("passwordChangeRequired", false);
    c.set("projectScope", null);
    await next();
  });
  app.route("/", router);
  app.onError((cause, c) => errorResponse(c, cause, undefined, false));
  return app;
}

describe("adapter ownership route guards", () => {
  it("runs the data ownership guard before the schema handler", async () => {
    const state: GuardState = { checked: 0, handled: 0 };
    const app = appWith(createDataRouter(createDataHandlers(dataService(state), false)), ACTOR);

    const response = await app.request("/projects/other/adapters/a1/schema");

    expect(response.status).toBe(404);
    expect(state).toEqual({ checked: 1, handled: 0 });
  });

  it("runs the import ownership guard before the normalizer handler", async () => {
    const state: GuardState = { checked: 0, handled: 0 };
    const app = appWith(
      createImportsRouter(createImportsHandlers(importsService(state), "/api", false)),
      ACTOR
    );

    const response = await app.request("/projects/other/adapters/a1/normalizers");

    expect(response.status).toBe(404);
    expect(state).toEqual({ checked: 1, handled: 0 });
  });

  it("requires authentication before consulting adapter ownership", async () => {
    const state: GuardState = { checked: 0, handled: 0 };
    const app = appWith(createDataRouter(createDataHandlers(dataService(state), false)), null);

    const response = await app.request("/projects/other/adapters/a1/schema");

    expect(response.status).toBe(401);
    expect(state).toEqual({ checked: 0, handled: 0 });
  });
});
