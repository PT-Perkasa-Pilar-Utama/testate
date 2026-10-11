import { describe, expect, it } from "bun:test";
import type { Actor, JsonObject } from "@testate/shared";
import { lastChangeSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { createClock, createTestDb } from "../../../test/db.ts";
import { PROJECT_ID, QA_ACTOR, TOKEN_ACTOR } from "../../lib/mock/fixtures.ts";
import { createAuditRepository } from "./audit.repository.ts";
import { createAuditService } from "./audit.service.ts";
import type { AuditService } from "./audit.service.ts";

const TINA: Actor = { ...QA_ACTOR, id: "01991f00-0000-7000-8000-0000000000c1", label: "tina.qa" };
const ME: Actor = { ...QA_ACTOR };

type Harness = {
  audit: AuditService;
  act(actor: Actor, action: string, label: string, details?: JsonObject): void;
};

function setup(): Harness {
  const clock = createClock();
  const audit = createAuditService({ repo: createAuditRepository(createTestDb()), now: clock.now });
  return {
    audit,
    act(actor, action, label, details = {}) {
      clock.advance(1000);
      audit.record({
        actor,
        action,
        target_type: "checkout",
        target_id: `t-${action}`,
        target_label: label,
        project: { id: PROJECT_ID, slug: "shop" },
        adapter: { id: null, name: "orders-db" },
        details,
        outcome: "succeeded",
      });
    },
  };
}

describe("the last data change by someone else (#60)", () => {
  it("answers the contract", () => {
    expectContract(
      lastChangeSchema,
      {
        last_change: {
          action: "checkout.created",
          actor: { kind: "user", label: "tina.qa" },
          target_label: "before-refund",
          adapter_name: null,
          at: "2026-10-11T09:00:00.000Z",
        },
      },
      (clone) => {
        clone["last_change"] = { action: "state.created" };
      }
    );
  });

  it("names another tester's checkout, with the state and when", async () => {
    const { audit, act } = setup();
    act(TINA, "checkout.created", "before-refund");
    const { last_change } = await audit.lastChange(PROJECT_ID, ME);
    expect(last_change).toMatchObject({
      action: "checkout.created",
      actor: { kind: "user", label: "tina.qa" },
      target_label: "before-refund",
    });
  });

  it("leaves out the caller's own changes", async () => {
    const { audit, act } = setup();
    act(TINA, "write_session.started", "orders-db");
    act(ME, "checkout.created", "mine");
    expect((await audit.lastChange(PROJECT_ID, ME)).last_change?.action).toBe(
      "write_session.started"
    );
    expect((await audit.lastChange(PROJECT_ID, TINA)).last_change?.target_label).toBe("mine");
  });

  it("leaves out acts that change no data, and a dry-run import", async () => {
    const { audit, act } = setup();
    act(TINA, "import.run", "customers-csv", { dry_run: false });
    act(TINA, "import.run", "preview-csv", { dry_run: true });
    act(TINA, "state.created", "after-import");
    act(TINA, "diff.created", "a-diff");
    const { last_change } = await audit.lastChange(PROJECT_ID, ME);
    expect(last_change?.action).toBe("import.run");
    expect(last_change?.target_label).toBe("customers-csv");
  });

  it("counts a token as someone else", async () => {
    const { audit, act } = setup();
    act(TOKEN_ACTOR, "file.deleted", "fixtures/orders.csv");
    expect((await audit.lastChange(PROJECT_ID, ME)).last_change?.actor).toStrictEqual({
      kind: "token",
      label: "token:ci-shop",
    });
  });

  it("answers null when nobody else changed anything", async () => {
    const { audit, act } = setup();
    act(ME, "checkout.created", "mine");
    expect(await audit.lastChange(PROJECT_ID, ME)).toStrictEqual({ last_change: null });
  });
});
