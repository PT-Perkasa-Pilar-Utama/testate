import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { apiContext, bearerContext, createToken, demoAdapter, demoProjectId } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import {
  fakeDocker,
  fakeElasticsearch,
  fakeJournalHost,
  fakeLoki,
  journalEntry,
} from "./lib/fakes.ts";
import type { FakeHost, FakeLine } from "./lib/fakes.ts";
import {
  awaitStatement,
  createLogAdapter,
  holdStatement,
  idIn,
  messagesOf,
  readLogs,
} from "./lib/log-adapters.ts";
import type { LogDraft, LogsPage } from "./lib/log-adapters.ts";
import { deleteAdapter } from "./lib/logs.ts";
import { callTool } from "./lib/mcp.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);
const API_LINE = `POST /refund 500 ${STAMP}`;
const WORKER_LINE = `job refund-sweep failed ${STAMP}`;

/** A line in the viewer's entry list, not the collapsed Fields under it. */
const entry = (page: Page, text: string) => page.locator("main li pre", { hasText: text });

/** The source on screen shows its own line and not the other source's. */
async function expectSourceShows(page: Page, shown: string, hidden: string): Promise<void> {
  await expect(entry(page, shown).first()).toBeVisible({ timeout: 15_000 });
  await expect(entry(page, hidden)).toHaveCount(0);
}

/**
 * Two sources over one engine, each a different service: reading one shows its own line only,
 * which is what proves the source's query, unit or container reached the engine.
 */
async function readBothSources(page: Page, id: string): Promise<void> {
  await page.goto(`/projects/demo/adapters/${id}?source=api`);
  await settle(page);
  await expectSourceShows(page, API_LINE, WORKER_LINE);
  await page.getByRole("combobox", { name: "Source", exact: true }).selectOption("worker");
  await expectSourceShows(page, WORKER_LINE, API_LINE);
}

/** Lines a minute or two old, one per service, named as each engine names its writer. */
function linesFor(api: string, worker: string): FakeLine[] {
  const now = Date.now();
  return [
    { at: now - 90_000, service: api, text: API_LINE },
    { at: now - 60_000, service: worker, text: WORKER_LINE },
  ];
}

test.describe("remote log engines", () => {
  test.use({ storageState: statePath("qa") });
  // One worker holds the fakes and the adapters beforeAll made; a failure does not skip the rest.
  test.describe.configure({ mode: "default" });

  const hosts: FakeHost[] = [];
  const made: string[] = [];
  const ids = new Map<string, string>();

  test.beforeAll(async () => {
    const qa = await apiContext("qa");
    const loki = await fakeLoki(linesFor("api", "worker"));
    const search = await fakeElasticsearch(linesFor("api", "worker"));
    const docker = await fakeDocker(linesFor("shop-api", "shop-worker"));
    const journal = await fakeJournalHost(
      linesFor("api.service", "worker.service").map((line, at) => journalEntry(at + 1, line)),
      { user: "deploy", password: "deploy-e2e" }
    );
    hosts.push(loki, search, docker, journal);
    const drafts: LogDraft[] = [
      {
        kind: "logs",
        engine: "loki",
        name: `loki-${STAMP}`,
        config: {
          url: `http://127.0.0.1:${loki.port}`,
          sources: [
            { name: "api", query: '{service="api"}' },
            { name: "worker", query: '{service="worker"}' },
          ],
        },
        secrets: {},
      },
      {
        kind: "logs",
        engine: "elasticsearch",
        name: `search-${STAMP}`,
        config: {
          url: `http://127.0.0.1:${search.port}`,
          sources: [
            { name: "api", index: "logs-*", query: "service:api" },
            { name: "worker", index: "logs-*", query: "service:worker" },
          ],
        },
        secrets: {},
      },
      {
        kind: "logs",
        engine: "docker",
        name: `docker-${STAMP}`,
        // A read-only socket proxy: the Engine API over plain TCP, no SSH login on the host.
        config: {
          transport: "tcp",
          host: "127.0.0.1",
          port: docker.port,
          scheme: "http",
          sources: [
            { name: "api", container: "shop-api" },
            { name: "worker", container: "shop-worker" },
          ],
        },
        secrets: {},
      },
      {
        kind: "logs",
        engine: "journald",
        name: `journal-${STAMP}`,
        config: {
          host: "127.0.0.1",
          port: journal.port,
          user: "deploy",
          sources: [
            { name: "api", units: ["api.service"] },
            { name: "worker", units: ["worker.service"] },
          ],
        },
        secrets: { password: "deploy-e2e" },
      },
    ];
    for (const draft of drafts) {
      const { id } = await createLogAdapter(qa, draft);
      made.push(id);
      ids.set(draft.engine, id);
    }
    await qa.dispose();
  });

  test.afterAll(async () => {
    const qa = await apiContext("qa");
    for (const id of made) await deleteAdapter(qa, "demo", id);
    await qa.dispose();
    for (const host of hosts) await host.close();
  });

  const idOf = (engine: string): string => idIn(ids, engine);

  test("@story-160 reads a host's systemd journal over SSH, one source per group of units", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await readBothSources(page, idOf("journald"));
    expect(issues).toStrictEqual([]);
  });

  test("@story-161 reads container logs through a read-only socket proxy, one source per container", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await readBothSources(page, idOf("docker"));
    expect(issues).toStrictEqual([]);
  });

  test("@story-162 reads Loki with each source's own LogQL query", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await readBothSources(page, idOf("loki"));
    expect(issues).toStrictEqual([]);
  });

  test("@story-163 reads Elasticsearch on an index pattern with each source's Lucene query", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await readBothSources(page, idOf("elasticsearch"));
    expect(issues).toStrictEqual([]);
  });

  test("@story-159 a database page shows its recent statements and the grant for the log it cannot read", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const marker = `e2e-statement-${STAMP}`;
    const session = holdStatement(marker);
    await awaitStatement(marker);
    const postgres = await demoAdapter({ engine: "postgres" });
    // `?source=` opens the page on its Server logs, as a run's "Logs during this run" link does.
    await page.goto(`/projects/demo/adapters/${postgres.id}?source=statements`);
    await settle(page);
    await expect(entry(page, marker).first()).toBeVisible({ timeout: 15_000 });
    // The compose Postgres runs with logging_collector off: its server log is the grant shown.
    await expect(page.getByText("Also available with more access:")).toBeVisible();
    await expect(
      page.getByText("logging_collector = on, and GRANT pg_read_server_files TO testate;")
    ).toBeVisible();
    session.release();
    expect(issues).toStrictEqual([]);
  });
});

test.describe("pushed logs", () => {
  const SECRET = `tok_live_${STAMP}4242`;
  const PUSHED = [
    { level: "error", message: `refund failed token=${SECRET}`, service: { name: "checkout" } },
    { level: "info", message: `refund retried ${STAMP}`, service: { name: "checkout" } },
  ];
  const body = PUSHED.map((line) => JSON.stringify(line)).join("\n");

  test("@story-157 an app pushes with an ingest token that opens nothing else", async () => {
    const qa = await apiContext("qa");
    const pushed = await createLogAdapter(qa, {
      kind: "logs",
      engine: "ingest",
      name: `push-${STAMP}`,
      config: {},
      secrets: {},
    });
    const other = await createLogAdapter(qa, {
      kind: "logs",
      engine: "ingest",
      name: `push-other-${STAMP}`,
      config: {},
      secrets: {},
    });
    const app = await bearerContext(String(pushed.ingest_token));
    const push = await app.post(`ingest/${pushed.id}`, { data: body });
    expect(push.status()).toBe(202);
    expect(await push.json()).toStrictEqual({ data: { accepted: 2, malformed: 0 } });
    // The lines sit beside the project's data, raw for a tester.
    expect(messagesOf(await readLogs(qa, pushed.id, "checkout"))).toContain(
      `refund failed token=${SECRET}`
    );
    // The same token reaches nothing but its own adapter's push.
    const refused = [
      (await app.post(`ingest/${other.id}`, { data: body })).status(),
      (await app.get("projects")).status(),
      (await app.get(`projects/demo/adapters/${pushed.id}/logs?source=checkout`)).status(),
      (await app.post("mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status(),
    ];
    expect(refused).toStrictEqual([401, 401, 401, 401]);
    await app.dispose();
    await deleteAdapter(qa, "demo", pushed.id);
    await deleteAdapter(qa, "demo", other.id);
    await qa.dispose();
  });

  test("@story-156 an agent reads a log source over MCP, always masked", async () => {
    const qa = await apiContext("qa");
    const admin = await apiContext("admin");
    const pushed = await createLogAdapter(qa, {
      kind: "logs",
      engine: "ingest",
      name: `agent-logs-${STAMP}`,
      config: {},
      secrets: {},
    });
    const app = await bearerContext(String(pushed.ingest_token));
    expect((await app.post(`ingest/${pushed.id}`, { data: body })).status()).toBe(202);
    // A tester's agent: its role alone would read raw, so only the agent rule masks it.
    const created = await createToken(admin, {
      name: `log-agent-${STAMP}`,
      kind: "agent",
      role: "qa",
      project_ids: [await demoProjectId(admin)],
    });
    const mcp = await bearerContext(created.token);
    const read: LogsPage = await callTool(mcp, "read_logs", {
      project: "demo",
      adapter: pushed.id,
      source: "checkout",
    });
    const leaked = read.entries.filter((line) => line.message.includes(SECRET));
    const masked = read.entries.filter((line) => line.masked).map((line) => line.message);
    expect(leaked).toStrictEqual([]);
    expect(masked).toStrictEqual(["refund failed token=***"]);
    // A tester reading the same source sees the raw line: the agent's copy was masked for it.
    expect(messagesOf(await readLogs(qa, pushed.id, "checkout"))).toContain(
      `refund failed token=${SECRET}`
    );
    await Promise.all([mcp.dispose(), app.dispose()]);
    await admin.delete(`tokens/${created.record.id}`);
    await deleteAdapter(qa, "demo", pushed.id);
    await Promise.all([admin.dispose(), qa.dispose()]);
  });
});
