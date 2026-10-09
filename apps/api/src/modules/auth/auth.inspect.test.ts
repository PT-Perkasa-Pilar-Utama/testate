import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { JsonObject, Role, TokenKind } from "@testate/shared";

import { TEST_META, createAccounts } from "../../../test/accounts.ts";
import type { AccountsHarness } from "../../../test/accounts.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { errorResponse } from "../../lib/http/index.ts";
import { ensureInspectProject } from "../projects/projects.inspect.ts";
import { createAuthHandlers } from "./auth.handler.ts";
import { createAuthRouter } from "./auth.router.ts";
import { INSPECT_VIEWER_ONLY } from "./auth.tokens.ts";

// #56, Q6 (docs/decisions/2026-10-09-inspect-project.md): a token that reaches Inspect is a viewer.
const SHOP = "01991f00-0000-7000-8000-000000000021";

async function setup(): Promise<{ harness: AccountsHarness; inspect: string }> {
  const harness = await createAccounts();
  ensureInspectProject(harness.projectsRepo, () => harness.admin.id, harness.now);
  harness.projectsRepo.insert({
    id: SHOP,
    slug: "shop",
    name: "Shop",
    description: null,
    quota_bytes: null,
    created_by: harness.admin.id,
    created_at: harness.now().toISOString(),
  });
  const inspect = harness.projectsRepo.byKind("inspect")?.id ?? "";
  return { harness, inspect };
}

const body = (kind: TokenKind, role: Role, projectIds: string[] | null) => ({
  name: `${kind}-${role}`,
  kind,
  role,
  project_ids: projectIds,
});

describe("tokens that reach Inspect", () => {
  it("refuses a tester or admin token whose scope lists Inspect, alone or mixed", async () => {
    const { harness, inspect } = await setup();
    const refused: [TokenKind, Role, string[]][] = [
      ["standard", "qa", [inspect]],
      ["standard", "admin", [inspect]],
      ["agent", "qa", [inspect]],
      ["standard", "qa", [inspect, SHOP]],
      ["agent", "qa", [SHOP, inspect]],
    ];
    for (const [kind, role, ids] of refused) {
      await expect(
        harness.auth.createToken(harness.admin, body(kind, role, ids), TEST_META)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { field: "role" } });
    }
  });

  it("allows a viewer of either kind, and leaves 'every project' tokens alone", async () => {
    const { harness, inspect } = await setup();
    const allowed: [TokenKind, Role, string[] | null][] = [
      ["standard", "viewer", [inspect]],
      ["agent", "viewer", [inspect]],
      ["agent", "viewer", [inspect, SHOP]],
      ["standard", "qa", null],
      ["standard", "qa", [SHOP]],
    ];
    for (const [kind, role, ids] of allowed) {
      const created = await harness.auth.createToken(
        harness.admin,
        body(kind, role, ids),
        TEST_META
      );
      expect(created.record.project_ids).toStrictEqual(ids);
    }
  });

  it("answers the route with 400 and names the role", async () => {
    const { harness, inspect } = await setup();
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("actor", harness.admin);
      c.set("authKind", "bearer");
      c.set("projectScope", null);
      await next();
    });
    const settings = createTestSettings(harness.db, harness.audit, harness.now);
    const options = {
      env: "test",
      basePath: "/",
      secureCookies: false,
      trustProxy: false,
      now: harness.now,
      settings,
    };
    app.route("/", createAuthRouter(createAuthHandlers(harness.auth, options)));
    app.onError((cause, c) => errorResponse(c, cause, undefined, false));
    const sent: JsonObject = body("agent", "qa", [inspect]);
    const response = await app.request("/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sent),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: INSPECT_VIEWER_ONLY },
    });
  });
});
