import { describe, expect, it } from "bun:test";
import {
  columnPolicySchema,
  fixtureSchema,
  introspectionSchema,
  queryResultSchema,
  rowsPageSchema,
  writeSessionSchema,
} from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { ADAPTER_ID, ADAPTER_MONGO_ID, QA_ACTOR } from "../../lib/mock/fixtures.ts";
import {
  COLUMN_POLICY_MOCK,
  FIXTURE_MOCK,
  INTROSPECTION_MOCK,
  QUERY_RESULT_MOCK,
  ROWS_PAGE_MOCK,
  WRITE_SESSION_MOCK,
} from "./data.mock.ts";
import { createDataService } from "./data.service.ts";

const VIEWER = { ...QA_ACTOR, role: "viewer" } as const;

describe("data", () => {
  it("mocks match the contract", () => {
    expectContract(introspectionSchema, INTROSPECTION_MOCK, (clone) => {
      clone["tier"] = "graph";
    });
    expectContract(rowsPageSchema, ROWS_PAGE_MOCK, (clone) => {
      clone["page"] = { next_cursor: null };
    });
    expectContract(writeSessionSchema, WRITE_SESSION_MOCK, (clone) => {
      clone["foreign_key_checks"] = "yes";
    });
    expectContract(queryResultSchema, QUERY_RESULT_MOCK, (clone) => {
      clone["truncated"] = { rows: false };
    });
    expectContract(columnPolicySchema, COLUMN_POLICY_MOCK, (clone) => {
      clone["mask"] = "blur";
    });
    expectContract(fixtureSchema, FIXTURE_MOCK, (clone) => {
      clone["format"] = "yaml";
    });
  });

  it("refuses tabular-only operations on a document adapter", async () => {
    const service = createDataService();
    await expect(service.policies(ADAPTER_MONGO_ID)).rejects.toThrow("outside the adapter's tier");
  });

  it("requires a write session for write-mode queries", async () => {
    const service = createDataService();
    await expect(
      service.query(QA_ACTOR, ADAPTER_ID, { dialect: "sql", text: "DELETE FROM orders", mode: "write" })
    ).rejects.toThrow("forbidden");
  });

  it("masks fixtures for viewers and not for qa", async () => {
    const service = createDataService();
    const forViewer = await service.fixture(VIEWER, ADAPTER_ID, "public.orders");
    const forQa = await service.fixture(QA_ACTOR, ADAPTER_ID, "public.orders");
    expect(forViewer.masked_columns.length).toBeGreaterThan(0);
    expect(forQa.masked_columns).toStrictEqual([]);
  });

  it("locked policies need admin", async () => {
    const service = createDataService();
    await expect(
      service.removePolicy(QA_ACTOR, ADAPTER_ID, "public.users", "password_hash")
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { reason: "policy is locked" } });
  });
});
