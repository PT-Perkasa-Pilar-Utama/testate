import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft } from "@testate/shared";
import { ingestAnswerSchema, ingestTokenSchema } from "@testate/shared";
import { Hono } from "hono";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { logsDepsOf } from "../../../test/logs.ts";
import { errorResponse } from "../../lib/http/index.ts";
import { WideEvent } from "../../lib/logger/event.ts";
import { createLogsService } from "../logs/logs.service.ts";
import { ensureInspectProject } from "../projects/projects.inspect.ts";
import { createIngestHandlers } from "./ingest.handler.ts";
import { createIngestRouter } from "./ingest.router.ts";

// #75 (Q4b, Q10, I1–I8 of docs/decisions/2026-10-10-logs-tier.md): an app pushes lines with the
// adapter's own token; people read them by service, masked for viewers; rotation and clearing.
const INGEST: AdapterDraft = {
  kind: "logs",
  engine: "ingest",
  name: "app-logs",
  config: {},
  secrets: {},
};

const PAID = '{"level":"info","message":"paid","service":{"name":"billing"}}';
const LOGIN = '{"level":"warn","message":"login token=abc123secret","service":{"name":"auth"}}';

async function setup() {
  const h = await createAdaptersHarness();
  const created = await h.adapters.create(h.qa, "shop", INGEST, TEST_META);
  const logs = createLogsService(logsDepsOf(h));
  return { h, adapter: created.adapter, token: created.ingest_token ?? "", logs };
}

/** The ingest routes over the harness, as `actor` (null: an app with only its token). */
function app(h: AdaptersHarness, actor: Actor | null = null): Hono {
  const hono = new Hono();
  hono.use("*", async (c, next) => {
    c.set("event", new WideEvent("request", () => undefined));
    c.set("actor", actor);
    c.set("authKind", "bearer");
    c.set("projectScope", null);
    await next();
  });
  hono.route("/", createIngestRouter(createIngestHandlers(h.ingestService, false, h.now)));
  hono.onError((cause, c) => errorResponse(c, cause, undefined, false));
  return hono;
}

const actions = async (h: AdaptersHarness): Promise<string[]> =>
  (await h.audit.list({ limit: 20, action: "adapter." })).rows.map((row) => row.action);

const push = (hono: Hono, id: string, token: string, body: string): Promise<Response> =>
  Promise.resolve(
    hono.request(`/ingest/${id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/x-ndjson" },
      body,
    })
  );

describe("pushing lines", () => {
  it("creates the adapter with its token once, and stores what an app pushes, by service", async () => {
    const { h, adapter, token, logs } = await setup();
    const response = await push(app(h), adapter.id, token, `${PAID}\n${LOGIN}\nnot json\n`);
    const billing = await logs.read(
      h.qa,
      "shop",
      adapter.id,
      { source: "billing", limit: 10 },
      null
    );
    expect([token.startsWith("tsi_"), adapter.mode, response.status]).toEqual([
      true,
      "read_only",
      202,
    ]);
    expect(v.parse(v.object({ data: ingestAnswerSchema }), await response.json()).data).toEqual({
      accepted: 3,
      malformed: 1,
    });
    expect(await logs.sources("shop", adapter.id, null)).toEqual(["auth", "billing", "default"]);
    expect(billing.page.entries.map((entry) => entry.message)).toEqual(["paid"]);
  });

  it("masks a secret in a pushed line for a viewer, and not for a tester", async () => {
    const { h, adapter, token, logs } = await setup();
    await push(app(h), adapter.id, token, LOGIN);
    const read = (actor: Actor) =>
      logs.read(actor, "shop", adapter.id, { source: "auth", limit: 10 }, null);
    const [viewer, tester] = [await read({ ...h.qa, role: "viewer" }), await read(h.qa)];
    expect([...viewer.page.entries, ...tester.page.entries].map((entry) => entry.message)).toEqual([
      "login token=***",
      "login token=abc123secret",
    ]);
  });

  it("refuses a wrong token, another adapter's token and an API token alike", async () => {
    const { h, adapter, token } = await setup();
    const other = await h.adapters.create(h.qa, "shop", { ...INGEST, name: "other" }, TEST_META);
    const hono = app(h);
    const statuses = [
      (await push(hono, adapter.id, "tsi_wrong", PAID)).status,
      (await push(hono, other.adapter.id, token, PAID)).status,
      (await push(hono, adapter.id, "tst_an-api-token", PAID)).status,
    ];
    expect(statuses).toEqual([401, 401, 401]);
  });

  it("answers 429 past the adapter's budget, and charges refused tokens to the address", async () => {
    const { h, adapter, token } = await setup();
    h.ingestBudget.current = 1;
    const hono = app(h);
    const budget = [(await push(hono, adapter.id, token, PAID)).status];
    budget.push((await push(hono, adapter.id, token, PAID)).status);
    let refused = 0;
    for (let n = 0; n < 121; n += 1) refused = (await push(hono, adapter.id, "tsi_x", PAID)).status;
    expect([budget, refused]).toEqual([[202, 429], 429]);
  });

  it("is refused in Inspect, which stores no records of its own", async () => {
    const { h } = await setup();
    ensureInspectProject(h.projectsRepo, () => h.admin.id, h.now);
    await expect(h.adapters.create(h.qa, "inspect", INGEST, TEST_META)).rejects.toMatchObject({
      code: "PROJECT_READ_ONLY",
    });
  });
});

describe("the adapter page's controls", () => {
  it("rotates the token: the old one stops at once, the new one works, and it is audited", async () => {
    const { h, adapter, token } = await setup();
    const rotated = await app(h, h.qa).request(
      `/projects/shop/adapters/${adapter.id}/ingest-token/rotation`,
      { method: "POST" }
    );
    const { data } = v.parse(v.object({ data: ingestTokenSchema }), await rotated.json());
    const hono = app(h);
    expect([
      (await push(hono, adapter.id, token, PAID)).status,
      (await push(hono, adapter.id, data.token, PAID)).status,
      (await actions(h)).includes("adapter.ingest_token_rotated"),
    ]).toEqual([401, 202, true]);
  });

  it("clears every line for an admin, refuses a tester, and records it", async () => {
    const { h, adapter, token, logs } = await setup();
    await push(app(h), adapter.id, token, PAID);
    const path = `/projects/shop/adapters/${adapter.id}/logs/clear`;
    const tester = await app(h, h.qa).request(path, { method: "POST" });
    const admin = await app(h, h.admin).request(path, { method: "POST" });
    expect([tester.status, admin.status, await logs.sources("shop", adapter.id, null)]).toEqual([
      403,
      200,
      [],
    ]);
    expect(await actions(h)).toContain("adapter.logs_cleared");
  });

  it("sweeps a deleted adapter's folder and days past retention", async () => {
    const { h, adapter, token } = await setup();
    await push(app(h), adapter.id, token, PAID);
    h.db.query("DELETE FROM adapters WHERE id = ?").run(adapter.id);
    await h.ingestService.sweep();
    expect(await h.ingest.held()).toEqual([]);
  });
});
