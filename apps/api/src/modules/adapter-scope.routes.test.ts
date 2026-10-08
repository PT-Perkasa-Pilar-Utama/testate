import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Actor } from "@testate/shared";

import { errorResponse } from "../lib/http/index.ts";
import type { Handler } from "../lib/http/index.ts";
import { scopeDeps } from "../wiring.ts";
import { S3, createAdaptersHarness, createSettled } from "../../test/adapters.ts";
import type { DataHandlers } from "./data/data.handlers.ts";
import { createV1 } from "./index.ts";
import type { V1Deps } from "./index.ts";
import type { StorageHandlers } from "./storage/storage.handler.ts";

const ACTOR: Actor = {
  kind: "user",
  id: "01a05e00-0000-7000-8000-000000000001",
  label: "someone",
  role: "admin",
  agent: false,
};

type RouteState = { data: number; storage: number };

function handlerBag<T>(state: RouteState, kind: "data" | "storage" | null = null): T {
  const bag = new Proxy(
    {},
    {
      get: (_target, key: PropertyKey) => {
        if (kind === "data" && key === "schema")
          return async (c: Parameters<Handler>[0]) => {
            state.data += 1;
            return c.text("data reached");
          };
        if (kind === "storage" && key === "list")
          return async (c: Parameters<Handler>[0]) => {
            state.storage += 1;
            return c.text("storage reached");
          };
        return async (c: Parameters<Handler>[0]) => c.body(null, 204);
      },
    }
  );
  // SAFETY: each route handler lookup receives a function; the tested routes have explicit handlers.
  return bag as T;
}

function appWith(
  harness: Awaited<ReturnType<typeof createAdaptersHarness>>,
  state: RouteState,
  actor: Actor | null
): Hono {
  const scopes = scopeDeps(harness.projectsRepo, harness.repo);
  // SAFETY: the proxy supplies each dependency property read while createV1 mounts its routers.
  const deps = new Proxy({} as V1Deps, {
    get: (_target, key: PropertyKey) => {
      if (key === "projectScope" || key === "adapterScope") return scopes[key];
      if (key === "data") return handlerBag<DataHandlers>(state, "data");
      if (key === "storage") return handlerBag<StorageHandlers>(state, "storage");
      if (key === "resetState") return async (c: Parameters<Handler>[0]) => c.body(null, 204);
      return handlerBag<Record<string, Handler>>(state);
    },
  });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    c.set("authKind", "session");
    c.set("passwordChangeRequired", false);
    c.set("projectScope", null);
    await next();
  });
  app.route("/", createV1(deps));
  app.onError((cause, c) => errorResponse(c, cause, undefined, false));
  return app;
}

describe("adapter ownership route guard", () => {
  it("lets an owned Files adapter reach the data and storage routers", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, S3);
    const state: RouteState = { data: 0, storage: 0 };
    const app = appWith(harness, state, ACTOR);

    const data = await app.request(`/projects/shop/adapters/${adapter.id}/schema`);
    const storage = await app.request(`/projects/shop/adapters/${adapter.id}/entries`);

    expect(adapter.kind).toBe("storage");
    expect(await data.text()).toBe("data reached");
    expect(await storage.text()).toBe("storage reached");
    expect(state).toEqual({ data: 1, storage: 1 });
  });

  it("refuses a Files adapter owned by a different project before the storage handler", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, S3);
    harness.projectsRepo.insert({
      id: "01991f00-0000-7000-8000-000000000011",
      slug: "other",
      name: "Other",
      description: null,
      quota_bytes: null,
      created_by: harness.admin.id,
      created_at: harness.now().toISOString(),
    });
    const state: RouteState = { data: 0, storage: 0 };
    const app = appWith(harness, state, ACTOR);

    const response = await app.request(`/projects/other/adapters/${adapter.id}/entries`);

    expect(response.status).toBe(404);
    expect(state.storage).toBe(0);
  });

  it("lets the draft connection test through: `/adapters/test` names no adapter", async () => {
    const harness = await createAdaptersHarness();
    const state: RouteState = { data: 0, storage: 0 };
    const app = appWith(harness, state, ACTOR);

    const response = await app.request("/projects/shop/adapters/test", {
      method: "POST",
      headers: { "X-Testate-Request": "1" },
    });

    expect(response.status).toBe(204);
  });

  it("requires authentication before checking adapter ownership", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, S3);
    const state: RouteState = { data: 0, storage: 0 };
    const app = appWith(harness, state, null);

    const response = await app.request(`/projects/shop/adapters/${adapter.id}/entries`);

    expect(response.status).toBe(401);
    expect(state.storage).toBe(0);
  });
});
