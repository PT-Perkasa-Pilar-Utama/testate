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
  // The crawler submits every dialog it finds; it runs last so the assertions above see seeded state.
  projects: [
    { name: "coverage", testMatch: /coverage\.e2e\.ts/ },
    { name: "routes", testMatch: /routes\.e2e\.ts/ },
    // Contract and agent stories talk to the API only; nothing they touch is shared state.
    // Anchored: `(api|agent)\.e2e\.ts` also matched `state-api.e2e.ts`, which then ran a second
    // time here, in the first phase, taking states and checking them out beside the UI stories.
    { name: "api", testMatch: /\/(api|agent)\.e2e\.ts$/ },

    // Sorting and searching, before any spec adds accounts the counts here would not expect.
    { name: "tables", testMatch: /tables\.e2e\.ts/, dependencies: ["routes"] },
    {
      name: "flows",
      testMatch: /(flows|stories|gaps|admin|jobs|viewer|stores)\.e2e\.ts/,
      dependencies: ["routes"],
    },
    // Checkouts restore the demo databases; nothing else may edit them meanwhile.
    { name: "states", testMatch: /states(-viewer)?\.e2e\.ts/, dependencies: ["flows"] },
    // The API-only state stories hold the same adapters; they run between the two UI phases.
    { name: "state-api", testMatch: /state-api\.e2e\.ts/, dependencies: ["states"] },
    { name: "adapter", testMatch: /adapter\.e2e\.ts/, dependencies: ["state-api"] },
    { name: "crawl", testMatch: /buttons\.e2e\.ts/, dependencies: ["adapter"] },
    // README screenshots, skipped unless SHOTS=1; it reads the seeded demo like any other spec.
    { name: "screens", testMatch: /screens\.e2e\.ts/, dependencies: ["state-api"] },
    // The reactive-loop hunt: skipped unless STRESS=1, and it wants the data a full run leaves.
    { name: "stress", testMatch: /stress\.e2e\.ts/, dependencies: ["state-api"] },
    // Playwright runs projects in phases: a project starts when every project of the phase before
    // it has finished, not only the ones it depends on. These two used to sit in the crawl's
    // previous phase, and their 45 seconds held the crawl at the gate. They run beside boot now.
    // The only spec that drives the built bundle; the rest drive Vite, and a reactive loop can
    // exist in one and not the other. It reads the seeded demo, so it waits for the UI phases.
    { name: "bundle", testMatch: /bundle\.e2e\.ts/, dependencies: ["crawl"] },
    // Boot stories spawn API processes of their own; run them last so they never starve a crawl.
    {
      name: "boot",
      testMatch: /(boot|engine|types|session|storage)\.e2e\.ts/,
      dependencies: ["crawl"],
    },
  ],
  globalSetup: "./e2e/setup.ts",
  outputDir: join(E2E_DIR, "results"),
  fullyParallel: true,
  // A laptop runs five engines, Vite, the API and Chromium beside this; two tabs at a time keeps
  // it usable. A CI runner has the cores and nothing else to do.
  workers: process.env.CI === undefined ? 2 : 4,
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
