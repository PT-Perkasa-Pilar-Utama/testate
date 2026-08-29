import { expect, request, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { API_PORT, E2E_DIR } from "../playwright.config.ts";
import { apiContext, bearerContext, createToken, demoAdapters, demoProjectId } from "./lib/api.ts";

const STAMP = Date.now().toString(36);
type OpenApiDocument = { openapi: string; paths: object };
const SEALED_KEYS = ["password", "token", "secret", "connection_string", "secret_access_key"];

/** The stories below are contract stories: they have no control of their own on a screen. */
test.describe("API contract", () => {
  test("@story-116 the OpenAPI document lists the routes and /docs renders a reference", async ({
    page,
  }) => {
    const context = await apiContext("viewer");
    const document: OpenApiDocument = await (await context.get("openapi.json")).json();
    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(["/projects", "/jobs", "/mcp"])
    );
    await context.dispose();
    await page.goto(`http://localhost:${API_PORT}/api/v1/docs`);
    await expect(page.locator("body")).toContainText(/Testate/i, { timeout: 15_000 });
  });

  test("@story-117 every list answers one envelope, a cursor, and a documented limit", async () => {
    const context = await apiContext("viewer");
    const first = await context.get("projects?limit=1");
    expect(first.status()).toBe(200);
    const page1: { data: unknown[]; page: { next_cursor: string | null; limit: number } } =
      await first.json();
    expect(page1.data.length).toBeLessThanOrEqual(1);
    expect(page1.page.limit).toBe(1);

    const overLimit = await context.get("projects?limit=9999");
    expect(overLimit.status()).toBe(400);
    const failure: { error: { code: string; message: string } } = await overLimit.json();
    expect(failure.error.code).toBe("VALIDATION_ERROR");

    const missing = await context.get("projects/no-such-project-here");
    expect(missing.status()).toBe(404);
    const gone: { error: { code: string } } = await missing.json();
    expect(gone.error.code).toBe("NOT_FOUND");
    await context.dispose();
  });

  test("@story-34 no adapter response carries a sealed value and none is stored in the clear", async () => {
    const context = await apiContext("qa");
    const adapters = await demoAdapters("qa");
    for (const adapter of adapters) {
      const body = await (await context.get(`projects/demo/adapters/${adapter.id}`)).text();
      // The config comes back, so an empty body cannot pass this by accident.
      expect(body).toContain('"config"');
      const keys = SEALED_KEYS.filter((key) => body.includes(`"${key}"`));
      expect(keys).toStrictEqual([]);
    }
    await context.dispose();
    // The seed sets every database adapter's password to `testate`; sealed means it is not there.
    const metadata = readFileSync(join(E2E_DIR, "data", "metadata.db"), "latin1");
    expect(metadata).not.toContain('password":"testate');
  });

  test("@story-109 audit rows outlive the project they describe", async () => {
    const admin = await apiContext("admin");
    const slug = `audit-${STAMP}`;
    const created = await admin.post("projects", { data: { slug, name: `Audit ${STAMP}` } });
    expect(created.status()).toBe(201);
    const plan: { data: { plan_id: string } } = await (
      await admin.get(`projects/${slug}/deletion-plan`)
    ).json();
    const removed = await admin.post(`projects/${slug}/deletion`, {
      data: { confirm_slug: slug, plan_id: plan.data.plan_id, adapters: [] },
    });
    expect(removed.status()).toBe(202);
    await expect
      .poll(async () => (await admin.get(`projects/${slug}`)).status(), { timeout: 30_000 })
      .toBe(404);
    const audit: { data: { action: string; target: string | null }[] } = await (
      await admin.get("audit-logs?limit=200")
    ).json();
    expect(audit.data.some((row) => JSON.stringify(row).includes(slug))).toBe(true);
    await admin.dispose();
  });

  test("@story-9 a password change ends every other session of that user", async () => {
    const admin = await apiContext("admin");
    const username = `sessions-${STAMP}`;
    const first = "temp-password-1234";
    const next = "second-password-1234";
    const created = await admin.post("users", {
      data: { username, display_name: username, role: "viewer", temporary_password: first },
    });
    expect(created.status()).toBe(201);

    const base = `http://localhost:${API_PORT}/api/v1/`;
    const headers = { "X-Testate-Request": "1" };
    const one = await request.newContext({ baseURL: base, extraHTTPHeaders: headers });
    const two = await request.newContext({ baseURL: base, extraHTTPHeaders: headers });
    for (const context of [one, two]) {
      const login = await context.post("auth/login", { data: { username, password: first } });
      expect(login.status()).toBe(200);
    }
    const changed = await one.post("auth/password", { data: { current: first, next } });
    expect(changed.status()).toBe(204);
    expect((await two.get("auth/me")).status()).toBe(401);
    expect((await one.get("auth/me")).status()).toBe(200);
    await one.dispose();
    await two.dispose();
    await admin.delete(`users/${username}`).catch(() => null);
    await admin.dispose();
  });

  test("@story-134 @story-139 an agent token is scoped and reaches MCP only", async () => {
    const admin = await apiContext("admin");
    const demoId = await demoProjectId(admin);
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const agent = await createToken(admin, {
      name: `agent-${STAMP}`,
      kind: "agent",
      project_ids: [demoId],
      expires_at: expires,
    });
    expect(agent.record.kind).toBe("agent");
    expect(agent.record.project_ids).toStrictEqual([demoId]);
    expect(agent.record.expires_at).not.toBeNull();
    const standard = await createToken(admin, { name: `standard-${STAMP}`, role: "qa" });

    const asAgent = await bearerContext(agent.token);
    expect((await asAgent.get("projects")).status()).toBe(403);
    expect((await asAgent.get("jobs")).status()).toBe(403);
    const asStandard = await bearerContext(standard.token);
    const refused = await asStandard.post("mcp", {
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(refused.status()).toBe(403);

    await asAgent.dispose();
    await asStandard.dispose();
    await admin.delete(`tokens/${agent.record.id}`);
    await admin.delete(`tokens/${standard.record.id}`);
    await admin.dispose();
  });
});
