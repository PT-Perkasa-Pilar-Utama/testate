import { describe, expect, it } from "bun:test";
import { auditPayloadSchema } from "@testate/shared";
import { Hono } from "hono";

import { expectContract } from "../../../test/contract.ts";
import { createTestDb } from "../../../test/db.ts";
import { WideEvent } from "../../lib/logger/event.ts";
import { QA_ACTOR } from "../../lib/mock/fixtures.ts";
import { captureAuditPayloads } from "./audit.capture.ts";
import { PAYLOAD_CAP, REDACTED, createPayloadStore, keepBody, redact } from "./audit.payloads.ts";
import { createAuditRepository } from "./audit.repository.ts";
import { AUDIT_PAYLOAD_MOCK, createAuditService } from "./audit.service.ts";

const META = { ip: "10.0.0.1", user_agent: "curl", request_id: "req-1" };

/** The first row's id, or "" so a missing row fails on the assertion rather than on a throw. */
function idOf(row: { id: string } | undefined): string {
  return row === undefined ? "" : row.id;
}

describe("audit payload redaction", () => {
  it("mock matches the contract", () => {
    expectContract(auditPayloadSchema, AUDIT_PAYLOAD_MOCK, (clone) => {
      clone["state"] = "lost";
    });
  });

  it("replaces a secret whole, at any depth, whatever the key's shape", () => {
    const out = redact({
      password: "hunter22",
      config: { newPassword: "x", secret_access_key: "y", connection_string: "z" },
      secrets: { anything: "sealed" },
      list: [{ token: "tst_abc" }],
    });
    expect(out).toStrictEqual({
      password: REDACTED,
      config: { newPassword: REDACTED, secret_access_key: REDACTED, connection_string: REDACTED },
      secrets: REDACTED,
      list: [{ token: REDACTED }],
    });
  });

  it("keeps the ends of an identifier and hides a short one entirely", () => {
    expect(redact({ username: "engineer", email: "ab@x.io", host: "db" })).toStrictEqual({
      username: "eng**eer",
      email: "ab@*.io",
      host: "**",
    });
  });

  it("leaves ordinary fields alone, and a flag named after a secret", () => {
    expect(
      redact({ state_name: "seeded-baseline", force: false, n: 3, must_change_password: false })
    ).toStrictEqual({
      state_name: "seeded-baseline",
      force: false,
      n: 3,
      must_change_password: false,
    });
  });

  it("never keeps text it could not parse, and cuts a body at the cap", () => {
    expect(keepBody("not json {", null)).toStrictEqual({
      text: JSON.stringify({ note: "not kept: the body was not JSON" }),
      truncated: false,
    });
    const big = keepBody(JSON.stringify({ rows: "x".repeat(PAYLOAD_CAP) }), null);
    expect(big.truncated).toBe(true);
    expect(big.text?.length).toBe(PAYLOAD_CAP);
  });
});

describe("audit payload store", () => {
  it("keeps bodies only for a request that wrote a row, and reads them back by state", async () => {
    const db = createTestDb();
    const repo = createAuditRepository(db);
    const payloads = createPayloadStore(db);
    const audit = createAuditService({
      repo,
      payloads,
      now: () => new Date("2026-09-04T10:00:00Z"),
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("requestId", String(c.req.header("x-request-id")));
      c.set("event", new WideEvent("request", () => undefined));
      await next();
    });
    app.use(
      "*",
      captureAuditPayloads(payloads, () => new Date("2026-09-04T10:00:00Z"))
    );
    app.post("/audited", async (c) => {
      audit.record({
        actor: { ...QA_ACTOR },
        action: "user.created",
        target_type: "user",
        target_id: "u1",
        outcome: "succeeded",
        meta: { ...META, request_id: c.get("requestId") },
      });
      return c.json({ data: { id: "u1", token: "tst_secret" } }, 201);
    });
    app.post("/silent", async (c) => c.json({ data: { ok: true } }));

    const headers = { "content-type": "application/json", "x-request-id": "req-1" };
    const body = JSON.stringify({ username: "engineer", password: "hunter22" });
    await app.request("/audited", { method: "POST", headers, body });
    await app.request("/silent", {
      method: "POST",
      headers: { ...headers, "x-request-id": "req-2" },
      body,
    });

    const row = (await audit.list({ limit: 10 })).rows[0];
    expect(row?.request_id).toBe("req-1");
    expect(await audit.payload(idOf(row), { scope: null })).toStrictEqual({
      state: "kept",
      method: "POST",
      path: "/audited",
      status: 201,
      request: { username: "eng**eer", password: REDACTED },
      response: { data: { id: "u1", token: REDACTED } },
      request_truncated: false,
      response_truncated: false,
    });
    expect(payloads.get("req-2")).toBeNull();

    expect(payloads.prune("2026-09-05T00:00:00Z")).toBe(1);
    expect((await audit.payload(idOf(row), { scope: null }))?.state).toBe("expired");
    expect(await audit.payload("missing", { scope: null })).toBeNull();
  });

  it("does not keep the body of a password change, and answers none for a job's row", async () => {
    const db = createTestDb();
    const repo = createAuditRepository(db);
    const payloads = createPayloadStore(db);
    const audit = createAuditService({ repo, payloads });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("requestId", "req-3");
      c.set("event", new WideEvent("request", () => undefined));
      await next();
    });
    app.use("*", captureAuditPayloads(payloads));
    app.post("/auth/password", async (c) => {
      audit.record({
        actor: { ...QA_ACTOR },
        action: "auth.password_changed",
        target_type: "user",
        target_id: "u1",
        outcome: "succeeded",
        meta: { ...META, request_id: "req-3" },
      });
      return c.body(null, 204);
    });
    await app.request("/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: "old", next: "new" }),
    });
    expect(payloads.get("req-3")?.request).toStrictEqual({
      note: "not kept: the body is a credential",
    });
    expect(payloads.get("req-3")?.response).toBeNull();

    audit.record({
      actor: null,
      action: "retention.run",
      target_type: "instance",
      target_id: "self",
      outcome: "succeeded",
    });
    const system = (await audit.list({ limit: 10 })).rows.find((r) => r.action === "retention.run");
    expect((await audit.payload(idOf(system), { scope: null }))?.state).toBe("none");
  });
});
