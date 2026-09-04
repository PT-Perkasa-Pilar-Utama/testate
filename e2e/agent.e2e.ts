import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { apiContext, bearerContext, createToken, demoAdapter, demoProjectId } from "./lib/api.ts";
import { callTool, firstId, listTools, tableRef } from "./lib/mcp.ts";
import type { ToolTable } from "./lib/mcp.ts";

const STAMP = Date.now().toString(36);

/** An agent token scoped to the demo project, revoked when the test ends. */
async function agentSession(
  admin: APIRequestContext,
  name: string
): Promise<{ mcp: APIRequestContext; tokenId: string }> {
  const created = await createToken(admin, {
    name: `${name}-${STAMP}`,
    kind: "agent",
    project_ids: [await demoProjectId(admin)],
  });
  return { mcp: await bearerContext(created.token), tokenId: created.record.id };
}

test.describe("agent access over MCP", () => {
  test("@story-135 an agent lists tables, describes one, pages rows, and runs a read-only query", async () => {
    const admin = await apiContext("admin");
    const { mcp, tokenId } = await agentSession(admin, "reader");
    const postgres = await demoAdapter({ engine: "postgres" });
    const target = { project: "demo", adapter: postgres.id };

    expect(await listTools(mcp)).toEqual(expect.arrayContaining(["list_tables", "page_rows"]));

    const tables: ToolTable[] = await callTool(mcp, "list_tables", target);
    const ref = tableRef(tables, "customers");

    const described: { columns: { name: string }[] } = await callTool(mcp, "describe_table", {
      ...target,
      table: ref,
    });
    expect(described.columns.map((column) => column.name)).toContain("email");

    const paged: { rows: { email: string }[] } = await callTool(mcp, "page_rows", {
      ...target,
      table: ref,
      limit: 5,
    });
    expect(paged.rows.length).toBeGreaterThan(0);
    expect(paged.rows.length).toBeLessThanOrEqual(5);

    const queried: { rows: { email: string }[]; columns: { name: string }[] } = await callTool(
      mcp,
      "run_readonly_query",
      { ...target, sql: `select email from ${ref} limit 3` }
    );
    expect(queried.columns.map((column) => column.name)).toContain("email");
    expect(queried.rows.length).toBeGreaterThan(0);

    await mcp.dispose();
    await admin.delete(`tokens/${tokenId}`);
    await admin.dispose();
  });

  test("a token answers for itself until it is revoked, and then answers 401 everywhere", async () => {
    const admin = await apiContext("admin");
    const { mcp, tokenId } = await agentSession(admin, "checker");
    // A live agent token reaches `/mcp` and nothing else: off it, the answer is 403, not 401, so a
    // person can tell "wrong door" from "dead token" before blaming their client.
    expect((await mcp.get("auth/me")).status()).toBe(403);
    expect((await mcp.get("projects")).status()).toBe(403);
    expect(
      (await mcp.post("mcp", { data: { jsonrpc: "2.0", id: 1, method: "ping" } })).status()
    ).toBe(200);

    await admin.delete(`tokens/${tokenId}`);
    // Revoked and expired fail the same way: there is no refresh, so reconnecting is a new token.
    expect((await mcp.get("auth/me")).status()).toBe(401);
    expect(
      (await mcp.post("mcp", { data: { jsonrpc: "2.0", id: 1, method: "ping" } })).status()
    ).toBe(401);
    await mcp.dispose();
    await admin.dispose();
  });

  test("@story-136 an agent extracts a fixture as SQL and as JSON", async () => {
    const admin = await apiContext("admin");
    const { mcp, tokenId } = await agentSession(admin, "fixture");
    const postgres = await demoAdapter({ engine: "postgres" });
    const target = { project: "demo", adapter: postgres.id };
    const tables: ToolTable[] = await callTool(mcp, "list_tables", target);
    const ref = tableRef(tables, "orders");
    const rows: { rows: { id: number }[] } = await callTool(mcp, "page_rows", {
      ...target,
      table: ref,
      limit: 1,
    });
    const pk = { id: firstId(rows.rows) };

    const sql: { format: string; content: string; tables: string[] } = await callTool(
      mcp,
      "extract_fixture",
      { ...target, table: ref, pk, format: "sql", direction: "parents" }
    );
    expect(sql.format).toBe("sql");
    expect(sql.content).toMatch(/insert into/i);
    expect(sql.tables).toEqual(expect.arrayContaining([expect.stringContaining("customers")]));

    const asJson: { format: string; content: string; tables: string[] } = await callTool(
      mcp,
      "extract_fixture",
      { ...target, table: ref, pk, format: "json", direction: "parents" }
    );
    expect(asJson.format).toBe("json");
    expect(Object.keys(JSON.parse(asJson.content)).length).toBeGreaterThan(0);
    expect(asJson.tables).toEqual(expect.arrayContaining([expect.stringContaining("orders")]));

    await mcp.dispose();
    await admin.delete(`tokens/${tokenId}`);
    await admin.dispose();
  });

  test("@story-137 every agent tool call is audited with its tool name and target", async () => {
    const admin = await apiContext("admin");
    const { mcp, tokenId } = await agentSession(admin, "audited");
    const postgres = await demoAdapter({ engine: "postgres" });
    await callTool(mcp, "list_tables", { project: "demo", adapter: postgres.id });
    const audit: { data: { action: string; target_id: string | null; details: unknown }[] } =
      await (await admin.get("audit-logs?limit=100")).json();
    const rows = audit.data.filter((row) => JSON.stringify(row).includes("list_tables"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).toContain(postgres.id);

    await mcp.dispose();
    await admin.delete(`tokens/${tokenId}`);
    await admin.dispose();
  });

  test("@story-138 a masked column stays masked for an agent and offers no unmask", async () => {
    const admin = await apiContext("admin");
    const { mcp, tokenId } = await agentSession(admin, "masked");
    // MySQL: the policy tests on other screens all use the Postgres adapter.
    const mysql = await demoAdapter({ engine: "mysql" });
    const target = { project: "demo", adapter: mysql.id };
    const tables: ToolTable[] = await callTool(mcp, "list_tables", target);
    const ref = tableRef(tables, "customers");
    const policy = `projects/demo/adapters/${mysql.id}/policies/${encodeURIComponent(ref)}/email`;
    const saved = await admin.put(policy, { data: { mask: "redact", required_function: null } });
    expect([200, 201, 204]).toContain(saved.status());

    const paged: { rows: { email: string }[]; masked_columns: string[] } = await callTool(
      mcp,
      "page_rows",
      { ...target, table: ref, limit: 3, unmask: true }
    );
    expect(paged.masked_columns).toContain("email");
    expect(paged.rows.map((row) => row.email)).not.toContain("a@x.io");

    const queried: { rows: { email: string }[]; masked_columns: string[] } = await callTool(
      mcp,
      "run_readonly_query",
      { ...target, sql: `select email from ${ref} limit 3` }
    );
    expect(queried.masked_columns).toContain("email");
    expect(JSON.stringify(queried.rows)).not.toContain("a@x.io");

    await admin.delete(policy);
    await mcp.dispose();
    await admin.delete(`tokens/${tokenId}`);
    await admin.dispose();
  });
});
