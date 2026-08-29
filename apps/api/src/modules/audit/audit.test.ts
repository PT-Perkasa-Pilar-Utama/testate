import { describe, expect, it } from "bun:test";
import { auditRowSchema } from "@testate/shared";
import * as v from "valibot";

import { expectContract } from "../../../test/contract.ts";
import { createClock, createTestDb } from "../../../test/db.ts";
import { QA_ACTOR } from "../../lib/mock/fixtures.ts";
import { createAuditRepository } from "./audit.repository.ts";
import { AUDIT_ROW_MOCK, createAuditService } from "./audit.service.ts";
import type { AuditService } from "./audit.service.ts";

type AuditHarness = { audit: AuditService; advance: (ms: number) => void };

function setup(): AuditHarness {
  const clock = createClock();
  const audit = createAuditService({ repo: createAuditRepository(createTestDb()), now: clock.now });
  return { audit, advance: clock.advance };
}

describe("audit", () => {
  it("mock matches the contract", () => {
    expectContract(auditRowSchema, AUDIT_ROW_MOCK, (clone) => {
      clone["outcome"] = "unknown";
    });
  });

  it("stores a row and reads it back with the actor kind and details", async () => {
    const { audit } = setup();
    audit.record({
      actor: { ...QA_ACTOR },
      action: "user.created",
      target_type: "user",
      target_id: "u1",
      details: { role: "qa" },
      outcome: "succeeded",
      meta: { ip: "10.0.0.1", user_agent: "curl", request_id: null },
    });
    const page = await audit.list({ limit: 10 });
    expect(page.rows.map((row) => row.action)).toStrictEqual(["user.created"]);
    expect(page.rows[0]?.actor).toStrictEqual({
      kind: "user",
      id: QA_ACTOR.id,
      label: QA_ACTOR.label,
    });
    expect(page.rows[0]?.details).toStrictEqual({ role: "qa" });
    expect(page.rows[0]?.ip).toBe("10.0.0.1");
  });

  it("records system rows without an actor", async () => {
    const { audit } = setup();
    audit.record({
      actor: null,
      action: "boot",
      target_type: "instance",
      target_id: "x",
      outcome: "succeeded",
    });
    const page = await audit.list({ limit: 10 });
    expect(page.rows[0]?.actor).toStrictEqual({ kind: "system", id: null, label: "system" });
  });

  it("filters by action prefix and outcome", async () => {
    const { audit } = setup();
    audit.record({
      actor: null,
      action: "auth.login",
      target_type: "user",
      target_id: "a",
      outcome: "succeeded",
    });
    audit.record({
      actor: null,
      action: "auth.login_failed",
      target_type: "user",
      target_id: "a",
      outcome: "failed",
    });
    audit.record({
      actor: null,
      action: "user.created",
      target_type: "user",
      target_id: "b",
      outcome: "succeeded",
    });
    expect((await audit.list({ limit: 10, action: "auth." })).rows.length).toBe(2);
    expect((await audit.list({ limit: 10, outcome: "failed" })).rows.length).toBe(1);
    expect((await audit.list({ limit: 10, action: "nothing." })).rows.length).toBe(0);
  });

  it("pages newest first with a keyset cursor", async () => {
    const { audit, advance } = setup();
    for (const target of ["1", "2", "3"]) {
      audit.record({
        actor: null,
        action: "x",
        target_type: "t",
        target_id: target,
        outcome: "succeeded",
      });
      advance(1000);
    }
    const first = await audit.list({ limit: 2 });
    expect(first.rows.map((row) => row.target_id)).toStrictEqual(["3", "2"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await audit.list({ limit: 2, cursor: v.parse(v.string(), first.nextCursor) });
    expect(second.rows.map((row) => row.target_id)).toStrictEqual(["1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("exports every page as CSV and quotes commas", async () => {
    const { audit } = setup();
    audit.record({
      actor: null,
      action: "x",
      target_type: "t",
      target_id: "a,b",
      outcome: "succeeded",
    });
    audit.record({ actor: null, action: "y", target_type: "t", target_id: "c", outcome: "failed" });
    const csv = await audit.exportCsv({ limit: 1 });
    const lines = csv.trimEnd().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(
      "created_at,actor,action,target_type,target_id,project,adapter,outcome,ip"
    );
    expect(lines.some((line) => line.includes('"a,b"'))).toBe(true);
  });
});
