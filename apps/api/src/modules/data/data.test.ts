import { describe, expect, it } from "bun:test";
import {
  columnPolicySchema,
  fixtureSchema,
  introspectionSchema,
  queryResultSchema,
  rowsPageSchema,
  writeSessionSchema,
} from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { expectContract } from "../../../test/contract.ts";
import { createDataHarness, cursorOf, harnessStashes } from "../../../test/data-harness.ts";
import { parseFilter } from "./data.handler.ts";
import {
  COLUMN_POLICY_MOCK,
  FIXTURE_MOCK,
  INTROSPECTION_MOCK,
  QUERY_RESULT_MOCK,
  ROWS_PAGE_MOCK,
  WRITE_SESSION_MOCK,
} from "./data.mock.ts";

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

  it("parses grid filters and rejects malformed ones", () => {
    expect(parseFilter("status:eq:paid")).toEqual({ column: "status", op: "eq", value: "paid" });
    expect(parseFilter("note:like:a:b")).toEqual({ column: "note", op: "like", value: "a:b" });
    expect(() => parseFilter("status:between:1")).toThrow("invalid filter");
  });

  it("introspects the live schema and pages rows with sort, filter, and cursor", async () => {
    const h = await createDataHarness();
    const schema = await h.data.schema(h.adapterId);
    expect(schema.tables.map((table) => table.name)).toEqual(["customers", "orders"]);
    const first = await h.data.rows(h.viewer, h.adapterId, "public.customers", {
      limit: 1,
      order: "desc",
    });
    expect(first.data).toEqual([{ id: 2, email: "b@x.io" }]);
    expect(first.page).toMatchObject({ kind: "offset", limit: 1 });
    const second = await h.data.rows(h.viewer, h.adapterId, "public.customers", {
      limit: 1,
      order: "desc",
      cursor: cursorOf(first),
    });
    expect(second.data).toEqual([{ id: 1, email: "a@x.io" }]);
    expect(second.page.next_cursor).toBeNull();
    const filtered = await h.data.rows(h.viewer, h.adapterId, "public.customers", {
      filters: [{ column: "email", op: "eq", value: "a@x.io" }],
    });
    expect(filtered.data.length).toBe(1);
  });

  it("runs read queries, records history per caller, and refuses write mode without a session", async () => {
    const h = await createDataHarness();
    const result = await h.data.query(h.viewer, h.adapterId, {
      dialect: "sql",
      text: "SELECT * FROM public.orders",
      mode: "read",
    });
    expect(result.rows).toEqual([{ id: 1, customer_id: 1, total: "10.00" }]);
    expect(result.columns.map((column) => column.name)).toEqual(["id", "customer_id", "total"]);
    await expect(
      h.data.query(h.viewer, h.adapterId, { dialect: "sql", text: "DELETE FROM x", mode: "read" })
    ).rejects.toMatchObject({ code: "ADAPTER_UNREACHABLE" });
    await expect(
      h.data.query(h.viewer, h.adapterId, { dialect: "sql", text: "DELETE FROM x", mode: "write" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.data.query(h.harness.qa, h.adapterId, {
        dialect: "sql",
        text: "DELETE FROM x",
        mode: "write",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { reason: "write session required" } });
    const own = await h.data.history(h.viewer, h.adapterId, 10);
    expect(own.map((row) => row.error === null)).toEqual([false, true]);
    expect((await h.data.history(h.harness.admin, h.adapterId, 10)).length).toBe(2);
  });

  it("takes one stash on the session's first write and counts later writes", async () => {
    const h = await createDataHarness();
    const session = await h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META);
    expect(session).toMatchObject({
      foreign_key_checks: true,
      stash_state_id: null,
      fk_checks_mapping: "SET CONSTRAINTS ALL DEFERRED",
    });
    await expect(
      h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META)
    ).rejects.toThrow("a write session is already open");
    const write = {
      dialect: "sql" as const,
      text: "UPDATE orders SET total = 0",
      mode: "write" as const,
      write_session_id: session.id,
    };
    expect((await h.data.query(h.harness.qa, h.adapterId, write)).rows_affected).toBe(1);
    await h.data.query(h.harness.qa, h.adapterId, write);
    const stashes = harnessStashes(h.harness);
    expect(stashes).toEqual([{ kind: "stash", stash_reason: "write-session", write_count: 2 }]);
    expect(
      h.harness.db.query("SELECT COUNT(*) AS n FROM states WHERE kind = 'stash'").get()
    ).toEqual({ n: 1 });
    expect(h.harness.projectsRepo.bySlug("shop")?.head.state_name).toBe("init");
    await h.data.endWriteSession(h.harness.qa, session.id, TEST_META);
    await expect(h.data.query(h.harness.qa, h.adapterId, write)).rejects.toThrow(
      "write session is closed"
    );
  });

  it("refuses write sessions on read-only adapters and tabular-only operations elsewhere", async () => {
    const h = await createDataHarness();
    await h.harness.adapters.setMode(h.harness.qa, "shop", h.adapterId, "read_only", TEST_META);
    await expect(
      h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META)
    ).rejects.toMatchObject({
      code: "ADAPTER_READ_ONLY",
    });
    await expect(h.data.schema("01991f00-0000-7000-8000-000000000999")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
