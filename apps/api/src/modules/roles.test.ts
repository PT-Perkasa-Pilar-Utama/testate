import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Role } from "@testate/shared";

import { errorResponse } from "../lib/http/index.ts";
import { createAdaptersRouter } from "./adapters/adapters.router.ts";
import { createAuditRouter } from "./audit/audit.router.ts";
import { createAuthRouter } from "./auth/auth.router.ts";
import { createCheckoutsRouter } from "./checkouts/checkouts.router.ts";
import { createDataRouter } from "./data/data.router.ts";
import { createDiffsRouter } from "./diffs/diffs.router.ts";
import { createImportsRouter } from "./imports/imports.router.ts";
import { createJobsRouter } from "./jobs/jobs.router.ts";
import { createProjectsRouter } from "./projects/projects.router.ts";
import { createSettingsRouter } from "./settings/settings.router.ts";
import { createStatesRouter } from "./states/states.router.ts";
import { createStorageRouter } from "./storage/storage.router.ts";
import { createToolsRouter } from "./tools/tools.router.ts";
import { createUsersRouter } from "./users/users.router.ts";
import { createV1 } from "./index.ts";
import { requireProjectInScope } from "./projects/projects.scope.ts";
import type { SlugLookup } from "./projects/projects.scope.ts";

/**
 * A handler bag of any depth, where every leaf answers 204. Middleware stubs can call `next` so
 * the adapter-scope middleware does not short-circuit the route under test.
 *
 * The proxy wraps a function so it is both a bag to reach into and a handler to call: `createV1`
 * takes bags of bags, and writing every field out would make this test a copy of the route table
 * it exists to check.
 */
function stubs<T>(middleware = false): T {
  // SAFETY: two assertions with the same justification. The proxy answers every property with
  // another proxy and every call with a 204, so it satisfies any bag-of-handlers shape a router
  // asks for; nothing here reads a real field off it.
  const target = ((): void => undefined) as never;
  // SAFETY: as above.
  return new Proxy(target, {
    get: () => stubs(),
    apply: (_target, _thisArg, args) => {
      if (middleware) {
        // SAFETY: Hono supplies `next` as the second argument to a middleware handler.
        return (args[1] as () => Promise<Response>)();
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  }) as T;
}

type Caller = { role: Role; agent: boolean; kind: "user" | "token" };

const CALLERS = {
  guest: { role: "viewer", agent: false, kind: "user" },
  tester: { role: "qa", agent: false, kind: "user" },
  admin: { role: "admin", agent: false, kind: "user" },
  agentToken: { role: "qa", agent: true, kind: "token" },
} satisfies Record<string, Caller>;

/** The whole v1 surface behind one caller, with the real middleware and stub handlers. */
function appFor(caller: Caller): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("actor", {
      kind: caller.kind,
      id: "01a05e00-0000-7000-8000-000000000001",
      label: caller.kind === "user" ? "someone" : "token:someone",
      role: caller.role,
      agent: caller.agent,
    });
    c.set("authKind", caller.kind === "user" ? "session" : "bearer");
    c.set("projectScope", null);
    await next();
  });
  for (const make of [
    createAuthRouter,
    createUsersRouter,
    createProjectsRouter,
    createAdaptersRouter,
    createStatesRouter,
    createCheckoutsRouter,
    createDiffsRouter,
    createStorageRouter,
    createJobsRouter,
    createAuditRouter,
    createSettingsRouter,
    createToolsRouter,
  ]) {
    app.route("/", make(stubs()));
  }
  app.route("/", createDataRouter(stubs<Parameters<typeof createDataRouter>[0]>(true)));
  app.route("/", createImportsRouter(stubs<Parameters<typeof createImportsRouter>[0]>(true)));
  app.onError((cause, c) => errorResponse(c, cause, undefined, false));
  return app;
}

const APPS = new Map(Object.entries(CALLERS).map(([name, caller]) => [name, appFor(caller)]));

async function status(who: string, method: string, path: string): Promise<number> {
  const app = APPS.get(who);
  if (app === undefined) throw new Error(`no app for ${who}`);
  const response = await app.request(path, {
    method,
    // Cookie callers must carry the header on a mutation; bearer callers are exempt either way.
    headers: { "X-Testate-Request": "1" },
  });
  return response.status;
}

const P = "/projects/demo";
const A = `${P}/adapters/a1`;

/** Every route worth asserting a role on, with the lowest role that may reach it. */
const MATRIX: [string, string, Role][] = [
  ["GET", "/projects", "viewer"],
  ["GET", "/projects/defaults", "qa"],
  ["GET", "/adapter-hosts", "qa"],
  ["POST", `${P}/adapters/test`, "qa"],
  ["POST", `${A}/retest`, "qa"],
  ["GET", `${A}/deletion-plan`, "qa"],
  ["POST", `${A}/deletion`, "qa"],
  ["POST", `${P}/checkouts/preflight`, "qa"],
  ["POST", `${P}/checkouts/c1/retry`, "qa"],
  ["GET", `${P}/checkouts/c1/counters`, "viewer"],
  ["POST", `${P}/checkouts/c1/repair-counters`, "qa"],
  ["GET", `${P}/uploads/u1/archive-manifest`, "qa"],
  ["POST", "/tools/random", "viewer"],
  ["POST", "/projects", "qa"],
  ["PATCH", P, "qa"],
  ["POST", `${P}/deletion`, "admin"],
  ["GET", `${P}/deletion-plan`, "admin"],
  ["GET", `${P}/adapters`, "viewer"],
  ["POST", `${P}/adapters`, "qa"],
  ["PATCH", A, "qa"],
  ["POST", `${A}/mode`, "admin"],
  ["GET", "/storage-adapters", "viewer"],
  ["GET", `${P}/states`, "viewer"],
  ["POST", `${P}/states`, "qa"],
  ["PATCH", `${P}/states/s1`, "qa"],
  ["DELETE", `${P}/states/s1`, "qa"],
  ["GET", `${P}/states/s1/archive`, "viewer"],
  ["POST", `${P}/states/import`, "qa"],
  ["GET", `${P}/checkouts`, "viewer"],
  ["POST", `${P}/checkouts`, "qa"],
  ["POST", `${P}/checkouts/c1/terminate-blockers`, "qa"],
  ["GET", `${P}/diffs`, "viewer"],
  ["POST", `${P}/diffs`, "qa"],
  ["DELETE", `${P}/diffs/d1`, "qa"],
  ["GET", `${A}/tables/t/rows`, "viewer"],
  ["POST", `${A}/query`, "viewer"],
  ["POST", `${A}/write-sessions`, "qa"],
  ["POST", `${A}/tables/t/row-edits`, "qa"],
  ["PUT", `${A}/policies/t/c`, "qa"],
  ["POST", `${A}/policies/t/c/lock`, "admin"],
  ["POST", `${A}/policies/t/c/unlock`, "admin"],
  ["GET", `${A}/entries`, "viewer"],
  ["GET", `${A}/entries/download`, "viewer"],
  ["POST", `${A}/entries`, "qa"],
  ["DELETE", `${A}/entries`, "qa"],
  ["POST", `${A}/host-key/accept`, "qa"],
  ["GET", `${P}/imports`, "viewer"],
  ["POST", `${P}/imports`, "qa"],
  ["GET", "/jobs", "viewer"],
  ["POST", "/jobs/j1/cancel", "qa"],
  ["GET", "/audit-logs", "viewer"],
  ["GET", "/audit-logs/a1/payload", "admin"],
  ["GET", "/users", "admin"],
  ["POST", "/users", "admin"],
  ["DELETE", "/users/u1", "admin"],
  ["GET", "/tokens", "admin"],
  ["POST", "/tokens", "admin"],
  ["DELETE", "/tokens/t1", "admin"],
  ["GET", "/settings", "admin"],
  ["PATCH", "/settings", "admin"],
  ["POST", "/tools/hash", "viewer"],
  ["POST", "/tools/uuid", "viewer"],
];

const RANK = { viewer: 0, qa: 1, admin: 2 } satisfies Record<Role, number>;
const WHO: [string, Role][] = [
  ["guest", "viewer"],
  ["tester", "qa"],
  ["admin", "admin"],
];

/** Every route a caller reached that its role should not, and every one it should and did not. */
async function roleOffenders(): Promise<string[]> {
  const wrong: string[] = [];
  for (const [method, path, needed] of MATRIX) {
    for (const [who, role] of WHO) {
      const code = await status(who, method, path);
      const allowed = RANK[role] >= RANK[needed];
      const reached = code !== 403;
      // 404 means the route is not mounted, which is a broken assertion rather than a refusal.
      const note = code === 404 ? "route not found" : `needs ${needed}`;
      const bad = code === 404 || allowed !== reached;
      wrong.push(...(bad ? [`${who} ${method} ${path} -> ${code} (${note})`] : []));
    }
  }
  return wrong;
}

/** Every REST route an agent token got through, which should be none of them. */
async function agentReached(): Promise<string[]> {
  const reached: string[] = [];
  for (const [method, path] of MATRIX) {
    const code = await status("agentToken", method, path);
    reached.push(...(code === 403 || code === 404 ? [] : [`${method} ${path} -> ${code}`]));
  }
  return reached;
}

/** Knows one project, which is the whole of what the scope middleware asks a repository. */
const ONE_PROJECT: SlugLookup = {
  bySlug: (slug) => (slug === "mine" ? { id: "p-mine" } : null),
};

type ScopedKind = "token" | "user";

/**
 * The whole v1 surface for a caller scoped to one project, with the real scope middleware. A
 * session is scoped the same way a token is since #55, so every check runs as both.
 */
function scopedApp(kind: ScopedKind): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("actor", {
      kind,
      id: "01a05e00-0000-7000-8000-000000000002",
      label: kind === "token" ? "token:ci" : "vera",
      role: "admin",
      agent: false,
    });
    c.set("authKind", kind === "token" ? "bearer" : "session");
    c.set("projectScope", ["p-mine"]);
    await next();
  });
  // Read through rather than spread: a proxy over a function has no own keys to copy.
  // SAFETY: as in `stubs`. Every field read off this is answered by the proxy, never by the
  // empty object it wraps.
  const deps = new Proxy({} as Parameters<typeof createV1>[0], {
    get: (_target, key) => {
      // Mounted, so its own guard is what refuses (the development route, G1 in #55).
      if (key === "resetState") return stubs();
      if (key === "projectScope") return requireProjectInScope(ONE_PROJECT);
      if (key === "adapterScope") return stubs(true);
      if (key === "data") return stubs<Parameters<typeof createDataRouter>[0]>(true);
      if (key === "imports") return stubs<Parameters<typeof createImportsRouter>[0]>(true);
      return stubs();
    },
  });
  app.route("/", createV1(deps));
  app.onError((cause, c) => errorResponse(c, cause, undefined, false));
  return app;
}

/** A request carrying the CSRF header, so a session's refusal is the scope's and not CSRF's. */
async function scopedStatus(kind: ScopedKind, method: string, path: string): Promise<number> {
  const headers = { "X-Testate-Request": "1" };
  return (await scopedApp(kind).request(path, { method, headers })).status;
}

/** Every instance-administration route a project-scoped caller still reached. */
async function scopedReachedAdmin(kind: ScopedKind): Promise<string[]> {
  const reached: string[] = [];
  const paths: [string, string][] = [
    ["GET", "/users"],
    ["POST", "/users"],
    ["PATCH", "/users/u1"],
    ["DELETE", "/users/u1"],
    ["GET", "/tokens"],
    ["POST", "/tokens"],
    ["DELETE", "/tokens/t1"],
    ["GET", "/settings"],
    ["PATCH", "/settings"],
    ["POST", "/admin/reset-state"],
  ];
  for (const [method, path] of paths) {
    const code = await scopedStatus(kind, method, path);
    reached.push(...(code === 403 ? [] : [`${method} ${path} -> ${code}`]));
  }
  return reached;
}

/** Where a scoped caller saw a project it may not, or was refused the one it may. */
async function scopeOffenders(kind: ScopedKind): Promise<string[]> {
  const app = scopedApp(kind);
  const paths = [
    "",
    "/adapters",
    "/adapters/a1/entries",
    "/adapters/a1/tables/t/rows",
    "/states",
    "/states/s1",
    "/checkouts",
    "/diffs",
    "/imports",
    "/quota",
    "/head",
  ];
  const wrong: string[] = [];
  for (const path of paths) {
    const mine = (await app.request(`/projects/mine${path}`)).status;
    const theirs = (await app.request(`/projects/other${path}`)).status;
    wrong.push(...(mine === 404 ? [`own project refused at /projects/mine${path}`] : []));
    // 404 is deliberate: an out-of-scope project must not be revealed to exist (09 §9.5).
    wrong.push(
      ...(theirs === 404 ? [] : [`other project reachable at /projects/other${path} -> ${theirs}`])
    );
  }
  return wrong;
}

describe("who may reach what", () => {
  it("every route admits its own role and above, and refuses everyone below", async () => {
    expect(await roleOffenders()).toEqual([]);
  });

  it("an agent token reaches no REST route at all, whatever its role", async () => {
    expect(await agentReached()).toEqual([]);
  });

  it("a cookie caller mutating without the CSRF header is refused", async () => {
    const app = APPS.get("admin");
    const code = (await app?.request("/projects", { method: "POST" }))?.status;
    expect(code).toBe(403);
  });

  it.each(["token", "user"] as const)(
    "a scoped %s reaches its own project and 404s on every other, at every depth",
    async (kind) => {
      expect(await scopeOffenders(kind)).toEqual([]);
    }
  );

  it.each(["token", "user"] as const)(
    "a scoped %s administers nothing, so it cannot mint its own way out of the fence",
    async (kind) => {
      // The admin role here is on purpose: without this the caller could create an unscoped
      // token, or a user with a password it chose, and the scope would be decorative.
      expect(await scopedReachedAdmin(kind)).toEqual([]);
    }
  );

  it("a person creates projects, scoped or not; a token never does (#55, Q6)", async () => {
    expect(await scopedStatus("token", "POST", "/projects")).toBe(403);
    expect(await scopedStatus("user", "POST", "/projects")).toBe(204);
    expect(await status("tester", "POST", "/projects")).toBe(204);
  });
});

describe("the session routes", () => {
  it("refuse an agent token, which reaches /mcp and nothing else", async () => {
    expect(await status("agentToken", "GET", "/auth/me")).toBe(403);
    expect(await status("agentToken", "GET", "/auth/sessions")).toBe(403);
    expect(await status("agentToken", "POST", "/auth/logout")).toBe(403);
    expect(await status("tester", "GET", "/auth/me")).not.toBe(403);
  });
});
