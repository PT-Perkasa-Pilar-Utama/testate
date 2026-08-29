import type { RouteDef } from "./lib/router.ts";

export const ROUTE_NAMES = [
  "home",
  "login",
  "projects",
  "project",
  "adapter",
  "table",
  "query",
  "policies",
  "files",
  "requests",
  "jobs",
  "audit",
  "settings",
  "users",
  "tokens",
  "tools",
  "health",
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
  { name: "policies", pattern: "/projects/:slug/adapters/:id/policies", role: "viewer" },
  { name: "files", pattern: "/projects/:slug/adapters/:id/files", role: "viewer" },
  { name: "requests", pattern: "/projects/:slug/adapters/:id/requests", role: "viewer" },
  { name: "jobs", pattern: "/jobs", role: "viewer" },
  { name: "audit", pattern: "/audit", role: "admin" },
  { name: "settings", pattern: "/settings", role: "admin" },
  { name: "users", pattern: "/users", role: "admin" },
  { name: "tokens", pattern: "/tokens", role: "admin" },
  { name: "tools", pattern: "/tools", role: "viewer" },
  { name: "health", pattern: "/health", role: null },
];
