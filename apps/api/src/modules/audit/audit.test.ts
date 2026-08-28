import { describe, expect, it } from "bun:test";
import { auditRowSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { AUDIT_ROW_MOCK, createAuditService } from "./audit.service.ts";

describe("audit", () => {
  it("mock matches the contract", () => {
    expectContract(auditRowSchema, AUDIT_ROW_MOCK, (clone) => {
      clone["outcome"] = "unknown";
    });
  });

  it("filters by action prefix", async () => {
    const service = createAuditService();
    expect((await service.list({ action: "checkout." })).length).toBe(1);
    expect((await service.list({ action: "user." })).length).toBe(0);
  });
});
