/**
 * Browser click-through over CDP: boots the API and Vite on scratch ports, seeds `dev`, signs in
 * as admin, walks every screen, and fails on page errors or API 5xx. Screenshots land in
 * `.smoke/`. Run: `bun run click-through` (needs Google Chrome; compose engines optional).
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as v from "valibot";

import { evaluate, launchChrome, openPage } from "./cdp.ts";
import { setupThroughApi } from "./click-through.setup.ts";
import type { Page } from "./cdp.ts";

const ROOT = new URL("../../..", import.meta.url).pathname;
const OUT = join(ROOT, ".smoke");
const API_PORT = 3000;
const WEB_PORT = 5173;
const CDP_PORT = 9222;
const ADMIN_PASSWORD = "admin-password-1234";
const KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

type Issue = { screen: string; kind: string; detail: string };
const FINAL_PASSWORD = "admin-password-5678";

async function waitFor(url: string, tries = 100): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      await Bun.sleep(200);
    }
  }
  throw new Error(`${url} did not come up`);
}

async function settle(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const loading = await evaluate(
      page,
      "/Loading|Listing\\.\\.\\./.test(document.body.innerText)",
      v.boolean()
    );
    if (!loading) break;
    await Bun.sleep(100);
  }
  await Bun.sleep(150);
}

async function goto(page: Page, path: string): Promise<void> {
  await page.send("Page.navigate", { url: `http://localhost:${WEB_PORT}${path}` });
  await Bun.sleep(300);
  await settle(page);
}

async function shot(page: Page, name: string): Promise<void> {
  const result = v.parse(
    v.object({ data: v.string() }),
    await page.send("Page.captureScreenshot", { format: "png" })
  );
  await Bun.write(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
}

async function waitForSelector(page: Page, selector: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = await evaluate(
      page,
      `document.querySelector(${JSON.stringify(selector)}) !== null`,
      v.boolean()
    );
    if (found) return;
    await Bun.sleep(100);
  }
  throw new Error(`${selector} never appeared`);
}

/** Types into an input by name so Solid's onInput handlers fire. */
async function type(page: Page, name: string, value: string): Promise<void> {
  await waitForSelector(page, `input[name="${name}"]`);
  await evaluate(
    page,
    `(() => { const el = document.querySelector('input[name="${name}"]'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    v.boolean()
  );
}

async function clickText(page: Page, text: string): Promise<boolean> {
  return evaluate(
    page,
    `(() => { const el = [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`,
    v.boolean()
  );
}

type SetScreen = (name: string) => void;

async function walkScreens(page: Page, setScreen: SetScreen): Promise<void> {
  const screens: [string, string][] = [
    ["projects", "/projects"],
    ["project", "/projects/demo"],
    ["jobs", "/jobs"],
    ["audit", "/audit"],
    ["users", "/users"],
    ["tokens", "/tokens"],
    ["settings", "/settings"],
    ["tools", "/tools"],
    ["health", "/health"],
  ];
  for (const [name, path] of screens) {
    setScreen(name);
    await goto(page, path);
    await shot(page, `10-${name}`);
  }
}

const adapterList = v.array(
  v.object({
    id: v.string(),
    kind: v.string(),
    tier: v.string(),
    name: v.string(),
    status: v.string(),
  })
);
type AdapterRow = v.InferOutput<typeof adapterList>[number];

async function runQueryFlow(page: Page, issues: Issue[], screen: string): Promise<void> {
  await evaluate(
    page,
    `(() => { const el = document.querySelector('textarea[aria-label="SQL"]'); el.value = 'SELECT 1 AS one'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    v.boolean()
  );
  await clickText(page, "Run (read-only)");
  await Bun.sleep(1500);
  const ran = await evaluate(page, "document.body.innerText.includes('row(s)')", v.boolean());
  if (!ran) issues.push({ screen, kind: "flow", detail: "query console showed no result" });
}

async function walkDatabase(
  page: Page,
  issues: Issue[],
  adapter: AdapterRow,
  base: string
): Promise<void> {
  const screen = `adapter:${adapter.name}`;
  await goto(page, `${base}/query`);
  if (adapter.tier === "tabular") await runQueryFlow(page, issues, screen);
  await shot(page, `21-query-${adapter.name}`);
  if (adapter.tier === "tabular") {
    await goto(page, `${base}/policies`);
    await shot(page, `22-policies-${adapter.name}`);
  }
  const tables = await evaluate(
    page,
    `fetch('/api/v1/projects/demo/adapters/${adapter.id}/schema').then((r) => r.json()).then((j) => (j.data && j.data.tables || []).map((t) => t.schema ? t.schema + '.' + t.name : t.name))`,
    v.array(v.string())
  );
  const first = tables[0];
  if (first === undefined) return;
  await goto(page, `${base}/tables/${encodeURIComponent(first)}`);
  await shot(page, `23-grid-${adapter.name}`);
  if (adapter.tier !== "tabular" || !(await clickText(page, "Fixture"))) return;
  await Bun.sleep(1200);
  const opened = await evaluate(
    page,
    "document.querySelector('dialog[open]') !== null",
    v.boolean()
  );
  if (!opened) issues.push({ screen, kind: "flow", detail: "fixture dialog did not open" });
  await shot(page, `23-fixture-${adapter.name}`);
}

async function walkAdapters(page: Page, issues: Issue[], setScreen: SetScreen): Promise<void> {
  setScreen("adapters");
  const adapters = await evaluate(
    page,
    `fetch('/api/v1/projects/demo/adapters').then((r) => r.json()).then((j) => (j.data || []).map((a) => ({ id: a.id, kind: a.kind, tier: a.tier, name: a.name, status: a.status })))`,
    adapterList
  );
  await Bun.write(join(OUT, "adapters.json"), JSON.stringify(adapters, null, 2));
  for (const adapter of adapters) {
    const base = `/projects/demo/adapters/${adapter.id}`;
    setScreen(`adapter:${adapter.name}`);
    await goto(page, base);
    await shot(page, `20-adapter-${adapter.name}`);
    if (adapter.kind === "database") await walkDatabase(page, issues, adapter, base);
    if (adapter.kind === "storage") {
      await goto(page, `${base}/files`);
      await shot(page, `24-files-${adapter.name}`);
    }
    if (adapter.kind === "rest") {
      await goto(page, `${base}/requests`);
      await shot(page, `25-requests-${adapter.name}`);
    }
  }
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "data"), { recursive: true });
  const env = {
    ...Bun.env,
    PORT: String(API_PORT),
    TESTATE_ENV: "development",
    TESTATE_DATA_DIR: join(OUT, "data"),
    TESTATE_SECRETS_ACTIVE_KEY: KEY,
    TESTATE_ADMIN_PASSWORD: ADMIN_PASSWORD,
    TESTATE_LOG_STDOUT: "false",
  };
  const api = Bun.spawn(["bun", "apps/api/src/index.ts"], {
    cwd: ROOT,
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  const web = Bun.spawn(["bun", "run", "dev"], {
    cwd: join(ROOT, "apps/web"),
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  const chrome = await launchChrome(CDP_PORT, join(OUT, "chrome"));
  const issues: Issue[] = [];
  const notes: string[] = [];
  let screen = "boot";
  try {
    await waitFor(`http://localhost:${API_PORT}/api/v1/health/live`);
    await waitFor(`http://localhost:${WEB_PORT}/`);
    const page = await openPage(chrome.port);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Network.enable");
    await page.send("Log.enable");
    page.on("Runtime.exceptionThrown", (params) =>
      issues.push({ screen, kind: "page error", detail: JSON.stringify(params).slice(0, 300) })
    );
    page.on("Log.entryAdded", (params) => {
      const entry = v.safeParse(
        v.object({ entry: v.object({ level: v.string(), text: v.string() }) }),
        params
      );
      const resourceLoad = /Failed to load resource/.test(
        entry.success ? entry.output.entry.text : ""
      );
      if (entry.success && entry.output.entry.level === "error" && !resourceLoad)
        issues.push({
          screen,
          kind: "console error",
          detail: entry.output.entry.text.slice(0, 300),
        });
    });
    page.on("Network.responseReceived", (params) => {
      const response = v.safeParse(
        v.object({ response: v.object({ status: v.number(), url: v.string() }) }),
        params
      );
      if (!response.success) return;
      const { status, url } = response.output.response;
      if (status >= 500) issues.push({ screen, kind: "api 5xx", detail: `${status} ${url}` });
      else if (status === 404) notes.push(`[${screen}] 404 ${url}`);
    });

    screen = "setup";
    const seeded = await setupThroughApi(API_PORT, ADMIN_PASSWORD, FINAL_PASSWORD);
    await Bun.write(join(OUT, "seed.json"), JSON.stringify(seeded, null, 2));

    screen = "login";
    await goto(page, "/login");
    await type(page, "username", "admin");
    await type(page, "password", FINAL_PASSWORD);
    await clickText(page, "Sign in");
    await Bun.sleep(800);
    await settle(page);
    await shot(page, "01-after-login");

    await walkScreens(page, (name) => {
      screen = name;
    });
    await walkAdapters(page, issues, (name) => {
      screen = name;
    });
    page.close();
  } finally {
    chrome.close();
    api.kill();
    web.kill();
  }
  await Bun.write(join(OUT, "issues.json"), JSON.stringify(issues, null, 2));
  const lines = [
    `${issues.length} issue(s); screenshots in ${OUT}`,
    ...issues.map((issue) => `- [${issue.screen}] ${issue.kind}: ${issue.detail}`),
    ...notes.map((note) => `  note: ${note}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  if (issues.length > 0) process.exit(1);
}

await main();
