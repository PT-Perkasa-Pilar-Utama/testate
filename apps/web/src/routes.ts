import type { RouteDef } from "./lib/router.ts";

export const ROUTE_NAMES = [
  "home",
  "storage",
  "login",
  "projects",
  "project",
  "diff",
  "adapter",
  "table",
  "query",
  "imports",
  "masks",
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
  // A comparison is wide and has two of everything, which a dialog over a list cannot hold.
  { name: "diff", pattern: "/projects/:slug/diffs/:id", role: "viewer" },
  { name: "adapter", pattern: "/projects/:slug/adapters/:id", role: "viewer" },
  { name: "table", pattern: "/projects/:slug/adapters/:id/tables/:table", role: "viewer" },
  { name: "query", pattern: "/projects/:slug/adapters/:id/query", role: "viewer" },
  // An import normalizer belongs to an adapter (normalizers.adapter_id), so the screen does too;
  // it used to be a project tab that opened by asking which database (docs/PROJECT_REWORK.md).
  { name: "imports", pattern: "/projects/:slug/adapters/:id/imports", role: "qa" },
  // Masking rules are admin work (docs/UI_REWORK.md). The engine stays load-bearing for the grid,
  // imports, diffs and the agent surface; only the screen moves out of a tester's way.
  { name: "masks", pattern: "/projects/:slug/adapters/:id/masks", role: "admin" },
  // The old name still resolves: it was in links and in the toolbar for a release.
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
