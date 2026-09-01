import type { RouteDef } from "./lib/router.ts";

export const ROUTE_NAMES = [
  "home",
  "storage",
  "login",
  "projects",
  "project",
  "adapter",
  "table",
  "query",
  "policies",
  "files",
  "jobs",
  "account",
  "audit",
  "settings",
  "users",
  "tokens",
  "tools",
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];

/** `role: null` is public; every other route needs at least that role (cumulative). */
export const ROUTES: readonly RouteDef<RouteName>[] = [
  { name: "home", pattern: "/", role: "viewer" },
  { name: "login", pattern: "/login", role: null },
  { name: "projects", pattern: "/projects", role: "viewer" },
  { name: "project", pattern: "/projects/:slug", role: "viewer" },
  { name: "adapter", pattern: "/projects/:slug/adapters/:id", role: "viewer" },
  { name: "table", pattern: "/projects/:slug/adapters/:id/tables/:table", role: "viewer" },
  { name: "query", pattern: "/projects/:slug/adapters/:id/query", role: "viewer" },
  // Masking rules are admin work (docs/UI_REWORK.md). The engine stays load-bearing for the grid,
  // imports, diffs and the agent surface; only the screen moves out of a tester's way.
  { name: "policies", pattern: "/projects/:slug/adapters/:id/policies", role: "admin" },
  { name: "files", pattern: "/projects/:slug/adapters/:id/files", role: "viewer" },
  // A file store never enters a state and never gets checked out, so it is not a project
  // primitive; it gets its own screen (docs/PROJECT_REWORK.md).
  { name: "storage", pattern: "/storage", role: "viewer" },
  { name: "jobs", pattern: "/jobs", role: "viewer" },
  { name: "account", pattern: "/account", role: "viewer" },
  { name: "audit", pattern: "/audit", role: "admin" },
  { name: "settings", pattern: "/settings", role: "admin" },
  { name: "users", pattern: "/users", role: "admin" },
  { name: "tokens", pattern: "/tokens", role: "admin" },
  { name: "tools", pattern: "/tools", role: "viewer" },
];
