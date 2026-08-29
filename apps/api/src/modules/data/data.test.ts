import { describe, expect, it } from "bun:test";
import {
  columnPolicySchema,
  fixtureSchema,
  introspectionSchema,
  queryResultSchema,
  rowsPageSchema,
  writeSessionSchema,
} from "@testate/shared";
import type { Actor, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { createSettingsService } from "../settings/settings.service.ts";
import { parseFilter } from "./data.handler.ts";
import {
  COLUMN_POLICY_MOCK,
  FIXTURE_MOCK,
  INTROSPECTION_MOCK,
  QUERY_RESULT_MOCK,
  ROWS_PAGE_MOCK,
  WRITE_SESSION_MOCK,
} from "./data.mock.ts";
import { createPoliciesRepository } from "./data.policies.ts";
import { createDataRepository } from "./data.repository.ts";
import { createDataService } from "./data.service.ts";
import type { DataService } from "./data.service.ts";

type Harness = { harness: AdaptersHarness; data: DataService; adapterId: string; viewer: Actor };

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const adapter = await createSettled(harness, PG);
  const data = createDataService({
    engines: harness.engines,
    blobs: harness.blobs,
    ring: harness.ring,
    adapters: harness.repo,
    states: harness.states,
    repo: createDataRepository(harness.db),
    policies: createPoliciesRepository(harness.db),
    projects: harness.projectsRepo,
    jobs: harness.runtime.jobs,
    settings: createSettingsService(),
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, data, adapterId: adapter.id, viewer: { ...harness.qa, role: "viewer" } };
}

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
    const h = await createHarness();
    const schema = await h.data.schema(h.adapterId);
    expect(schema.tables.map((table) => table.name)).toEqual(["customers", "orders"]);
    const first = await h.data.rows(h.viewer, h.adapterId, "public.customers", { limit: 1, order: "desc" });
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
    const h = await createHarness();
    const result = await h.data.query(h.viewer, h.adapterId, { dialect: "sql", text: "SELECT * FROM public.orders", mode: "read" });
    expect(result.rows).toEqual([{ id: 1, customer_id: 1, total: "10.00" }]);
    expect(result.columns.map((column) => column.name)).toEqual(["id", "customer_id", "total"]);
    await expect(
      h.data.query(h.viewer, h.adapterId, { dialect: "sql", text: "DELETE FROM x", mode: "read" })
    ).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(
      h.data.query(h.viewer, h.adapterId, { dialect: "sql", text: "DELETE FROM x", mode: "write" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.data.query(h.harness.qa, h.adapterId, { dialect: "sql", text: "DELETE FROM x", mode: "write" })
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { reason: "write session required" } });
    const own = await h.data.history(h.viewer, h.adapterId, 10);
    expect(own.map((row) => row.error === null)).toEqual([false, true]);
    expect((await h.data.history(h.harness.admin, h.adapterId, 10)).length).toBe(2);
  });

  it("takes one stash on the session's first write and counts later writes", async () => {
    const h = await createHarness();
    const session = await h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META);
    expect(session).toMatchObject({ foreign_key_checks: true, stash_state_id: null, fk_checks_mapping: "SET CONSTRAINTS ALL DEFERRED" });
    await expect(h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META)).rejects.toThrow(
      "a write session is already open"
    );
    const write = { dialect: "sql" as const, text: "UPDATE orders SET total = 0", mode: "write" as const, write_session_id: session.id };
    expect((await h.data.query(h.harness.qa, h.adapterId, write)).rows_affected).toBe(1);
    await h.data.query(h.harness.qa, h.adapterId, write);
    const stashes = harnessStashes(h.harness);
    expect(stashes).toEqual([{ kind: "stash", stash_reason: "write-session", write_count: 2 }]);
    expect(h.harness.db.query("SELECT COUNT(*) AS n FROM states WHERE kind = 'stash'").get()).toEqual({ n: 1 });
    expect(h.harness.projectsRepo.bySlug("shop")?.head.state_name).toBe("init");
    await h.data.endWriteSession(h.harness.qa, session.id, TEST_META);
    await expect(h.data.query(h.harness.qa, h.adapterId, write)).rejects.toThrow("write session is closed");
  });

  it("refuses write sessions on read-only adapters and tabular-only operations elsewhere", async () => {
    const h = await createHarness();
    await h.harness.adapters.setMode(h.harness.qa, "shop", h.adapterId, "read_only", TEST_META);
    await expect(h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META)).rejects.toMatchObject({
      code: "ADAPTER_READ_ONLY",
    });
    await expect(h.data.schema("01991f00-0000-7000-8000-000000000999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("edits rows in one transaction with server-side functions and enforces column policies", async () => {
    const h = await createHarness();
    const session = await h.data.startWriteSession(h.harness.qa, h.adapterId, true, TEST_META);
    await h.data.upsertPolicy(
      h.harness.qa,
      h.adapterId,
      "public.customers",
      "email",
      { required_function: { name: "hash_sha256" }, mask: "partial", display: false },
      TEST_META
    );
    await expect(
      h.data.rowEdits(h.harness.qa, h.adapterId, "public.customers", session.id, [
        { kind: "insert", values: { email: { kind: "value", value: "raw@x.io" } } },
      ], TEST_META)
    ).rejects.toThrow("email requires the hash_sha256 function");
    const result = await h.data.rowEdits(h.harness.qa, h.adapterId, "public.customers", session.id, [
      { kind: "insert", values: { email: { kind: "function", name: "hash_sha256", input: "c@x.io" } } },
      { kind: "update", pk: { id: 1 }, values: { email: { kind: "function", name: "hash_sha256", input: "a2@x.io" } } },
      { kind: "delete", pk: { id: 2 } },
    ], TEST_META);
    expect(result.results.map((item) => item.kind)).toEqual(["insert", "update", "delete"]);
    expect(result.stash_state_id).not.toBeNull();
    const rows = customersOf(h.harness);
    expect(rows.map((row) => row["id"])).toEqual([1, 3]);
    expect(String(rows[0]?.["email"])).toHaveLength(64);
    await expect(
      h.data.rowEdits(h.harness.qa, h.adapterId, "public.customers", session.id, [{ kind: "delete", pk: { id: 99 } }], TEST_META)
    ).rejects.toMatchObject({ details: { failed_index: 0 } });
  });

  it("masks policed columns for viewers in the grid and queries, never for qa", async () => {
    const h = await createHarness();
    await h.data.upsertPolicy(h.harness.qa, h.adapterId, "public.customers", "email", { required_function: null, mask: "redact", display: false }, TEST_META);
    const grid = await h.data.rows(h.viewer, h.adapterId, "public.customers");
    expect(grid.data[0]?.["email"]).toBe("***");
    expect(grid.masked_columns).toEqual(["email"]);
    expect((await h.data.rows(h.harness.qa, h.adapterId, "public.customers")).data[0]?.["email"]).toBe("a@x.io");
    const query = await h.data.query(h.viewer, h.adapterId, { dialect: "sql", text: "SELECT * FROM public.customers", mode: "read" });
    expect(query.rows[0]?.["email"]).toBe("***");
    const schema = await h.data.schema(h.adapterId);
    expect(schema.tables[0]?.columns.find((column) => column.name === "email")?.policy.mask).toBe("redact");
  });

  it("locks policies for admin only and looks up foreign keys by display column", async () => {
    const h = await createHarness();
    await h.data.upsertPolicy(h.harness.qa, h.adapterId, "public.customers", "email", { required_function: null, mask: null, display: true }, TEST_META);
    await h.data.setPolicyLock(h.harness.admin, h.adapterId, "public.customers", "email", true, TEST_META);
    await expect(
      h.data.removePolicy(h.harness.qa, h.adapterId, "public.customers", "email", TEST_META)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.data.lookup(h.adapterId, "public.orders", "total", "", 20)).rejects.toThrow("not a foreign key column");
    await expect(h.data.lookup(h.adapterId, "public.orders", "customer_id", "", 20)).rejects.toThrow("not a foreign key column");
  });

  it("extracts a fixture with parents in dependency order, masked for viewers", async () => {
    const h = await createHarness();
    await h.data.upsertPolicy(h.harness.qa, h.adapterId, "public.customers", "email", { required_function: null, mask: "redact", display: false }, TEST_META);
    const request = { table: "public.orders", pk: { id: 1 }, depth: 2, direction: "parents" as const, format: "sql" as const };
    const fixture = await h.data.fixture(h.viewer, h.adapterId, request, TEST_META);
    expect(fixture).toMatchObject({ rows: 1, tables: ["public.orders"], truncated: false, masked_columns: [] });
    expect(fixture.content).toContain('INSERT INTO "public"."orders"');
    const json = await h.data.fixture(h.harness.qa, h.adapterId, { ...request, format: "json" }, TEST_META);
    expect(JSON.parse(json.content).tables[0].rows).toEqual([{ id: 1, customer_id: 1, total: "10.00" }]);
    await expect(h.data.fixture(h.viewer, h.adapterId, { ...request, pk: { id: 99 } }, TEST_META)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves, renames, and deletes queries with unique names", async () => {
    const h = await createHarness();
    const saved = await h.data.createSavedQuery(h.harness.qa, h.adapterId, { name: "paid", body: { text: "SELECT 1" } });
    await expect(
      h.data.createSavedQuery(h.harness.qa, h.adapterId, { name: "Paid", body: {} })
    ).rejects.toThrow("saved query name is taken");
    expect((await h.data.updateSavedQuery(h.adapterId, saved.id, { name: "paid-orders" })).name).toBe("paid-orders");
    await h.data.removeSavedQuery(h.adapterId, saved.id);
    expect(await h.data.savedQueries(h.adapterId)).toEqual([]);
  });
});

function customersOf(harness: AdaptersHarness): JsonObject[] {
  const rows = harness.databases.get("shop")?.get("public.customers");
  if (rows === undefined) throw new Error("no customers table");
  return rows;
}

function cursorOf(page: { page: { next_cursor: string | null } }): string {
  if (page.page.next_cursor === null) throw new Error("no next page");
  return page.page.next_cursor;
}

function harnessStashes(harness: AdaptersHarness): { kind: string; stash_reason: string | null; write_count: number }[] {
  const rows = harness.db
    .query(
      `SELECT s.kind, s.stash_reason, w.write_count FROM states s
       JOIN write_sessions w ON w.stash_state_id = s.id ORDER BY s.created_at`
    )
    .all();
  return v.parse(
    v.array(v.object({ kind: v.string(), stash_reason: v.nullable(v.string()), write_count: v.number() })),
    rows
  );
}
