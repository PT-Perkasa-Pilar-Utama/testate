import { describe, expect, it } from "bun:test";

import { TEST_META } from "../../../test/accounts.ts";
import { createDataHarness, customersOf } from "../../../test/data-harness.ts";

describe("data editing", () => {
  it("edits rows in one transaction with server-side functions and enforces column policies", async () => {
    const h = await createDataHarness();
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
      h.data.rowEdits(
        h.harness.qa,
        h.adapterId,
        "public.customers",
        session.id,
        [{ kind: "insert", values: { email: { kind: "value", value: "raw@x.io" } } }],
        TEST_META
      )
    ).rejects.toThrow("email requires the hash_sha256 function");
    const result = await h.data.rowEdits(
      h.harness.qa,
      h.adapterId,
      "public.customers",
      session.id,
      [
        {
          kind: "insert",
          values: { email: { kind: "function", name: "hash_sha256", input: "c@x.io" } },
        },
        {
          kind: "update",
          pk: { id: 1 },
          values: { email: { kind: "function", name: "hash_sha256", input: "a2@x.io" } },
        },
        { kind: "delete", pk: { id: 2 } },
      ],
      TEST_META
    );
    expect(result.results.map((item) => item.kind)).toEqual(["insert", "update", "delete"]);
    expect(result.stash_state_id).not.toBeNull();
    const rows = customersOf(h.harness);
    expect(rows.map((row) => row["id"])).toEqual([1, 3]);
    expect(String(rows[0]?.["email"])).toHaveLength(64);
    await expect(
      h.data.rowEdits(
        h.harness.qa,
        h.adapterId,
        "public.customers",
        session.id,
        [{ kind: "delete", pk: { id: 99 } }],
        TEST_META
      )
    ).rejects.toMatchObject({ details: { failed_index: 0 } });
  });

  it("masks policed columns for viewers in the grid and queries, never for qa", async () => {
    const h = await createDataHarness();
    await h.data.upsertPolicy(
      h.harness.qa,
      h.adapterId,
      "public.customers",
      "email",
      { required_function: null, mask: "redact", display: false },
      TEST_META
    );
    const grid = await h.data.rows(h.viewer, h.adapterId, "public.customers");
    expect(grid.data[0]?.["email"]).toBe("***");
    expect(grid.masked_columns).toEqual(["email"]);
    expect(
      (await h.data.rows(h.harness.qa, h.adapterId, "public.customers")).data[0]?.["email"]
    ).toBe("a@x.io");
    const query = await h.data.query(h.viewer, h.adapterId, {
      dialect: "sql",
      text: "SELECT * FROM public.customers",
      mode: "read",
    });
    expect(query.rows[0]?.["email"]).toBe("***");
    const schema = await h.data.schema(h.adapterId);
    expect(schema.tables[0]?.columns.find((column) => column.name === "email")?.policy.mask).toBe(
      "redact"
    );
  });

  it("locks policies for admin only and looks up foreign keys by display column", async () => {
    const h = await createDataHarness();
    await h.data.upsertPolicy(
      h.harness.qa,
      h.adapterId,
      "public.customers",
      "email",
      { required_function: null, mask: null, display: true },
      TEST_META
    );
    await h.data.setPolicyLock(
      h.harness.admin,
      h.adapterId,
      "public.customers",
      "email",
      true,
      TEST_META
    );
    await expect(
      h.data.removePolicy(h.harness.qa, h.adapterId, "public.customers", "email", TEST_META)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.data.lookup(h.adapterId, "public.orders", "total", "", 20)).rejects.toThrow(
      "not a foreign key column"
    );
    const found = await h.data.lookup(h.adapterId, "public.orders", "customer_id", "", 20);
    expect(found).toEqual([
      { key: [1], display: "a@x.io" },
      { key: [2], display: "b@x.io" },
    ]);
  });

  it("extracts a fixture with parents in dependency order, masked for viewers", async () => {
    const h = await createDataHarness();
    await h.data.upsertPolicy(
      h.harness.qa,
      h.adapterId,
      "public.customers",
      "email",
      { required_function: null, mask: "redact", display: false },
      TEST_META
    );
    const request = {
      table: "public.orders",
      pk: { id: 1 },
      depth: 2,
      direction: "parents" as const,
      format: "sql" as const,
    };
    const fixture = await h.data.fixture(h.viewer, h.adapterId, request, TEST_META);
    expect(fixture).toMatchObject({
      rows: 2,
      tables: ["public.customers", "public.orders"],
      truncated: false,
      masked_columns: ["public.customers.email"],
    });
    expect(fixture.content).toContain('INSERT INTO "public"."orders"');
    const json = await h.data.fixture(
      h.harness.qa,
      h.adapterId,
      { ...request, format: "json" },
      TEST_META
    );
    expect(JSON.parse(json.content).tables[1].rows).toEqual([
      { id: 1, customer_id: 1, total: "10.00" },
    ]);
    await expect(
      h.data.fixture(h.viewer, h.adapterId, { ...request, pk: { id: 99 } }, TEST_META)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves, renames, and deletes queries with unique names", async () => {
    const h = await createDataHarness();
    const saved = await h.data.createSavedQuery(h.harness.qa, h.adapterId, {
      name: "paid",
      body: { text: "SELECT 1" },
    });
    await expect(
      h.data.createSavedQuery(h.harness.qa, h.adapterId, { name: "Paid", body: {} })
    ).rejects.toThrow("saved query name is taken");
    expect(
      (await h.data.updateSavedQuery(h.adapterId, saved.id, { name: "paid-orders" })).name
    ).toBe("paid-orders");
    await h.data.removeSavedQuery(h.adapterId, saved.id);
    expect(await h.data.savedQueries(h.adapterId)).toEqual([]);
  });
});
