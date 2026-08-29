import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { ADMIN_PASSWORD, API_PORT, E2E_DIR } from "../playwright.config.ts";
import { PASSWORDS, ROLES, USERNAMES, statePath } from "./lib/roles.ts";

const API = `http://localhost:${API_PORT}/api/v1/`;
const HEADERS = { "X-Testate-Request": "1" };

async function login(username: string, password: string): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL: API, extraHTTPHeaders: HEADERS });
  const response = await context.post("auth/login", { data: { username, password } });
  if (!response.ok()) throw new Error(`${username}: login failed with ${response.status()}`);
  return context;
}

/** Rotates a temporary password to the final one; a data dir left by a previous run already has it. */
async function changePassword(username: string, from: string, to: string): Promise<void> {
  const probe = await request.newContext({ baseURL: API, extraHTTPHeaders: HEADERS });
  const already = await probe.post("auth/login", { data: { username, password: to } });
  await probe.dispose();
  if (already.ok()) return;
  const context = await login(username, from);
  const response = await context.post("auth/password", { data: { current: from, next: to } });
  if (!response.ok()) throw new Error(`${username}: password change failed ${response.status()}`);
  await context.dispose();
}

/**
 * One reset per run: the bootstrap admin changes its temporary password, lifts the loopback deny
 * list (the compose engines live on 127.0.0.1), seeds `dev`, then every role gets a final
 * password and a saved browser session.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(join(E2E_DIR, "state"), { recursive: true, force: true });
  mkdirSync(join(E2E_DIR, "state"), { recursive: true });
  await changePassword("admin", ADMIN_PASSWORD, PASSWORDS.admin);
  const admin = await login("admin", PASSWORDS.admin);
  await admin.patch("settings", { data: { netguard: { deny: [] } } });
  const reset = await admin.post("admin/reset-state", { data: { seed: "dev", confirm: "reset" } });
  const report: { data?: { adapters: number; warnings: string[] } } = await reset.json();
  if (report.data === undefined) throw new Error(`seed failed: ${await reset.text()}`);
  if (report.data.warnings.length > 0)
    throw new Error(`seed warnings: ${report.data.warnings.join("; ")}`);
  await admin.dispose();
  // The reset recreated every account with a temporary password.
  await changePassword("admin", ADMIN_PASSWORD, PASSWORDS.admin);
  await changePassword(USERNAMES.qa, "qa-password-1234", PASSWORDS.qa);
  await changePassword(USERNAMES.viewer, "viewer-password-1234", PASSWORDS.viewer);
  for (const role of ROLES) {
    const context = await login(USERNAMES[role], PASSWORDS[role]);
    await context.storageState({ path: statePath(role) });
    await context.dispose();
  }
}
