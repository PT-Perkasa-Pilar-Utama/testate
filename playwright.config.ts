import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite over the real API, Vite dev server, and the compose engines. `bun run e2e`.
 * The API boots on a scratch data dir with a fresh secrets key; global setup seeds `dev` and
 * signs in each role once (storage state per role under `.e2e/`).
 */
export const E2E_DIR = fileURLToPath(new URL(".e2e", import.meta.url));
export const API_PORT = 3000;
export const WEB_PORT = 5173;
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
  // The crawler submits every dialog it finds; it runs last so the assertions above see seeded state.
  projects: [
    { name: "coverage", testMatch: /coverage\.e2e\.ts/ },
    { name: "routes", testMatch: /routes\.e2e\.ts/ },
    { name: "flows", testMatch: /(flows|stories)\.e2e\.ts/, dependencies: ["routes"] },
    // Checkouts restore the demo databases; nothing else may edit them meanwhile.
    { name: "states", testMatch: /states\.e2e\.ts/, dependencies: ["flows"] },
    { name: "crawl", testMatch: /buttons\.e2e\.ts/, dependencies: ["states"] },
  ],
  globalSetup: "./e2e/setup.ts",
  outputDir: join(E2E_DIR, "results"),
  fullyParallel: true,
  workers: 3,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: join(E2E_DIR, "report"), open: "never" }]],
  use: {
    // CI uses the Chrome that GitHub runners preinstall; this skips `playwright install`.
    channel: process.env.CI === undefined ? undefined : "chrome",
    baseURL: `http://localhost:${WEB_PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command: "bun apps/api/src/index.ts",
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
    },
  ],
});
