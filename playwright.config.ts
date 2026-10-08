import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import { describeCapacity, workersFor } from "./e2e/lib/capacity.ts";
import { projectsFor } from "./e2e/lib/shards.ts";

/**
 * End-to-end suite over the real API, Vite dev server, and the compose engines. `bun run e2e`.
 * The API boots on a scratch data dir with a fresh secrets key; global setup seeds `dev` and
 * signs in each role once (storage state per role under `.e2e/`).
 */
export const E2E_DIR = fileURLToPath(new URL(".e2e", import.meta.url));

const CAPACITY = {
  cpus: availableParallelism(),
  load1: loadavg()[0] ?? 0,
  totalGiB: totalmem() / 2 ** 30,
  ci: process.env.CI !== undefined,
  override: process.env.E2E_WORKERS,
};
const WORKERS = workersFor(CAPACITY);
process.stdout.write(`${describeCapacity(CAPACITY, WORKERS)}\n`);
/**
 * Not the dev server's 7378/7379. The suite spawns an API and a Vite of its own, and Playwright
 * refuses to start when the port is taken, so running `bun run e2e` beside `bun run dev` used to
 * mean stopping the dev server first. Worse before that: a suite that reached the dev instance
 * instead ran its stories against a developer's own data and locked the admin account out of it.
 */
export const API_PORT = 7478;
export const WEB_PORT = 7479;
export const ADMIN_PASSWORD = "admin-password-1234";

/**
 * One secrets key per checkout, kept under `.e2e/`: this file is evaluated by every Playwright
 * process, so it must not wipe or rekey the data dir the API is already serving. The dev seed
 * resets every table on each run anyway.
 */
function secretsKey(): string {
  const path = join(E2E_DIR, "key.txt");
  if (!existsSync(path)) {
    mkdirSync(E2E_DIR, { recursive: true });
    writeFileSync(path, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"));
  }
  return readFileSync(path, "utf8").trim();
}
const key = secretsKey();

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts/,
  // The projects and their order live in e2e/lib/shards.ts. `E2E_SHARD` runs one CI shard of them
  // (#40); unset, the whole chain runs, as it does for `bun run e2e`.
  projects: projectsFor(process.env["E2E_SHARD"]),
  globalSetup: "./e2e/setup.ts",
  outputDir: join(E2E_DIR, "results"),
  fullyParallel: true,
  // Read off the machine at start, not fixed: a laptop already running five engines, Vite and the
  // API gets fewer tabs than an idle CI runner. `E2E_WORKERS` overrides the rule; the line printed
  // at start says what was chosen and why (e2e/lib/capacity.ts).
  workers: WORKERS,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: join(E2E_DIR, "report"), open: "never" }],
    ["./e2e/lib/timing.ts"],
  ],
  use: {
    // CI uses the Chrome that GitHub runners preinstall; this skips `playwright install`.
    channel: process.env.CI === undefined ? undefined : "chrome",
    baseURL: `http://localhost:${WEB_PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
    // Playwright emulates a light preference by default. Once the SPA honours
    // `prefers-color-scheme` that would flip all of it to light, and the README screenshots with
    // it. The suite and the shots are the dark theme; a light-theme story would say so itself.
    colorScheme: "dark",
  },
  webServer: [
    {
      // Builds first: the API rewrites the base-path placeholder in `apps/web/dist` at boot, so a
      // build afterwards would put the placeholder back under a server that has stopped looking.
      command: "bun run build:web && bun apps/api/src/index.ts",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        TESTATE_ENV: "development",
        TESTATE_DATA_DIR: join(E2E_DIR, "data"),
        TESTATE_SECRETS_ACTIVE_KEY: key,
        TESTATE_ADMIN_PASSWORD: ADMIN_PASSWORD,
        TESTATE_LOG_STDOUT: "false",
      },
    },
    {
      command: "bun run dev",
      cwd: "apps/web",
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WEB_PORT: String(WEB_PORT), API_PORT: String(API_PORT) },
    },
  ],
});
