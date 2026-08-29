import { join } from "node:path";

import { E2E_DIR } from "../../playwright.config.ts";

export const ROLES = ["admin", "qa", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** The seeded account per role (19 §19.3). */
export const USERNAMES = {
  admin: "admin",
  qa: "qa-user",
  viewer: "viewer-user",
} satisfies Record<Role, string>;

/** Final passwords after global setup rotates the seeded temporary ones. */
export const PASSWORDS = {
  admin: "admin-final-password-1",
  qa: "qa-final-password-1",
  viewer: "viewer-final-password-1",
} satisfies Record<Role, string>;

export function statePath(role: Role): string {
  return join(E2E_DIR, "state", `${role}.json`);
}

/** Top-level screens with the minimum role each needs (routes.ts); admin screens refuse the rest. */
export const SCREENS: { path: string; role: Role; nav: string | null }[] = [
  { path: "/projects", role: "viewer", nav: "Projects" },
  { path: "/projects/demo", role: "viewer", nav: null },
  { path: "/jobs", role: "viewer", nav: "Jobs" },
  { path: "/tools", role: "viewer", nav: "Tools" },
  { path: "/health", role: "viewer", nav: null },
  { path: "/audit", role: "admin", nav: "Audit" },
  { path: "/users", role: "admin", nav: "Users" },
  { path: "/tokens", role: "admin", nav: "Tokens" },
  { path: "/settings", role: "admin", nav: "Settings" },
];

const RANK = { viewer: 0, qa: 1, admin: 2 } satisfies Record<Role, number>;

export function allows(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export function outcomeOf(role: Role, minimum: Role): "renders" | "is refused" {
  return allows(role, minimum) ? "renders" : "is refused";
}

/** Sidebar labels the role sees, in screen order. */
export function navFor(role: Role): string[] {
  return SCREENS.filter((s) => s.nav !== null && allows(role, s.role)).map((s) => s.nav ?? "");
}

/** Sidebar labels the role must not see. */
export function hiddenNavFor(role: Role): string[] {
  return SCREENS.filter((s) => s.nav !== null && !allows(role, s.role)).map((s) => s.nav ?? "");
}
