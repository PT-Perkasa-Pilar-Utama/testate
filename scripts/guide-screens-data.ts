/**
 * The second half of scripts/guide-screens.ts: the screens that read or change data. Order
 * matters: the grid, the query and the import run before the checkout, which puts the rows back.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { WIDTH, fit, settle, shoot } from "./guide-marks.ts";
import { captureHistoryScreens } from "./guide-screens-history.ts";

const TABLE = "contract.customers";
const CSV = [
  "email,balance,big",
  "indra.wijaya@example.com,50000,4",
  "lina.kusuma@example.com,125000,6",
  "fajar.nugroho@example.com,7500,2",
].join("\n");

async function adapterId(page: Page, engine: string): Promise<string> {
  const response = await page.request.get("/api/v1/projects/demo/adapters");
  const body: { data: { id: string; engine: string }[] } = await response.json();
  const found = body.data.find((adapter) => adapter.engine === engine);
  if (found === undefined) throw new Error(`the demo project has no ${engine} adapter`);
  return found.id;
}

const CUSTOMERS = [
  ["siti.rahma@example.com", 250000, 3],
  ["budi.santoso@example.com", 120500.5, 7],
  ["ayu.lestari@example.com", 0, 2],
  ["dewi.anggraini@example.com", 875000, 11],
  ["rudi.hartono@example.com", 43000, 5],
  ["maria.tan@example.com", 15000, 1],
] as const;

/**
 * The seeded demo has two customers with test-fixture values, which reads as noise in a guide for
 * people who do not write tests. This adds six plausible ones before the snapshot, one insert per
 * row, so a row that a run before this one left in place is refused on its unique email and skipped.
 */
export async function addDemoCustomers(page: Page): Promise<void> {
  const base = `/api/v1/projects/demo/adapters/${await adapterId(page, "postgres")}`;
  const headers = { "X-Testate-Request": "1" };
  const started = await page.request.post(`${base}/write-sessions`, {
    headers,
    data: { foreign_key_checks: true },
  });
  if (!started.ok()) throw new Error(`write session answered ${started.status()}`);
  const session: { data: { id: string } } = await started.json();
  for (const [email, balance, big] of CUSTOMERS) {
    await page.request.post(`${base}/tables/${TABLE}/row-edits`, {
      headers,
      data: {
        write_session_id: session.data.id,
        edits: [
          {
            kind: "insert",
            values: {
              email: { kind: "value", value: email },
              balance: { kind: "value", value: balance },
              big: { kind: "value", value: big },
            },
          },
        ],
      },
    });
  }
  await page.request.delete(`${base}/write-sessions/${session.data.id}`, { headers });
}

async function databases(page: Page): Promise<void> {
  await page.goto("/projects/demo?tab=adapters");
  await settle(page);
  await fit(page);
  const row = page.locator("main tr").filter({ hasText: "shop-postgres" });
  await shoot(page, "11-databases", [
    {
      at: page.getByRole("button", { name: "Check out the starting point" }).locator("../.."),
      n: 1,
    },
    { at: row.getByRole("link", { name: "shop-postgres" }), n: 2 },
    { at: row.getByText("Sandbox"), n: 3 },
    { at: row.getByText("OK", { exact: true }), n: 4 },
  ]);
}

async function adapter(page: Page, id: string): Promise<void> {
  await page.goto(`/projects/demo/adapters/${id}`);
  await settle(page);
  await fit(page);
  const row = page.locator("main tr").filter({ hasText: TABLE });
  await shoot(page, "12-adapter", [
    { at: row.getByRole("link", { name: TABLE }), n: 1 },
    {
      at: row.getByRole("button", { name: "Import" }).or(row.getByRole("link", { name: "Import" })),
      n: 2,
    },
    {
      at: page
        .getByRole("link", { name: "Query console" })
        .or(page.getByRole("button", { name: "Query console" })),
      n: 3,
    },
    { at: page.getByRole("tab", { name: "Diagram" }).locator(".."), n: 4 },
    { at: page.getByRole("button", { name: "Retest connection" }), n: 5, side: "bottom" },
    { at: page.getByRole("button", { name: "Edit adapter" }), n: 6, side: "bottom" },
  ]);
}

async function grid(page: Page, id: string): Promise<void> {
  await page.goto(`/projects/demo/adapters/${id}/tables/${TABLE}`);
  await settle(page);
  await fit(page);
  await shoot(page, "13-grid", [
    { at: page.getByLabel("Filter column").locator("../.."), n: 1 },
    { at: page.getByText("Export CSV", { exact: true }).locator(".."), n: 2, side: "top" },
    { at: page.getByRole("switch", { name: "Write mode" }).locator(".."), n: 3, side: "top" },
    { at: page.locator("main thead tr").first(), n: 4 },
    { at: page.getByRole("button", { name: "Next" }).locator(".."), n: 5 },
  ]);
  await page.getByRole("switch", { name: "Write mode" }).click();
  await settle(page);
  await fit(page);
  const first = page.locator("main tbody tr").first();
  await shoot(page, "14-write-mode", [
    { at: page.getByText("Write mode is on."), n: 1 },
    { at: page.getByRole("button", { name: "Insert row" }), n: 2, side: "bottom" },
    { at: first.getByRole("button", { name: "Edit" }), n: 3, side: "top" },
    { at: first.getByRole("button", { name: "Row actions" }), n: 4, side: "right" },
    { at: page.getByRole("button", { name: "End write mode" }), n: 5, side: "bottom" },
  ]);
  await insertRow(page);
}

async function insertRow(page: Page): Promise<void> {
  await page.setViewportSize({ width: WIDTH, height: 820 });
  await page.getByRole("button", { name: "Insert row" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("id mode").selectOption({ label: "Default" });
  const value = (column: string) =>
    dialog.getByLabel(`${column} mode`).locator("xpath=ancestor::div[1]").locator("input").first();
  for (const [column, text] of [
    ["email", "putri.ayu@example.com"],
    ["balance", "98000"],
    ["big", "4"],
  ] as const) {
    await dialog.getByLabel(`${column} mode`).selectOption({ label: "Value" });
    await value(column).fill(text);
  }
  await shoot(
    page,
    "15-insert-row",
    [
      { at: dialog.getByLabel("id mode"), n: 1 },
      { at: value("email"), n: 2, side: "right" },
      { at: dialog.getByText("Copies").locator(".."), n: 3 },
      { at: dialog.getByRole("button", { name: "Insert", exact: true }), n: 4, side: "top" },
    ],
    dialog
  );
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await settle(page);
  await page.getByRole("button", { name: "End write mode" }).click();
  await settle(page);
}

async function query(page: Page, id: string): Promise<void> {
  await page.goto(`/projects/demo/adapters/${id}/query`);
  await settle(page);
  await page.getByLabel("SQL").fill(`SELECT id, email, balance FROM ${TABLE} ORDER BY id`);
  // The editor offers completions while typing; Escape closes the list before the shot.
  await page.getByLabel("SQL").press("Escape");
  await page.getByRole("button", { name: "Run (read-only)" }).click();
  await page.getByText(/\d+ row\(s\)/).waitFor();
  await fit(page);
  await shoot(page, "16-query", [
    { at: page.getByLabel("SQL"), n: 1 },
    { at: page.getByRole("button", { name: "Run (read-only)" }), n: 2 },
    { at: page.locator("main table").first(), n: 3 },
    { at: page.getByText("Export CSV", { exact: true }).locator(".."), n: 4 },
    { at: page.getByRole("tab", { name: "Saved" }).locator(".."), n: 5 },
    { at: page.getByPlaceholder("save as..."), n: 6 },
  ]);
}

async function documents(page: Page, id: string): Promise<void> {
  await page.goto(`/projects/demo/adapters/${id}`);
  await settle(page);
  await fit(page);
  await shoot(page, "17-documents", [
    { at: page.locator("main").getByText("orders", { exact: true }), n: 1 },
    { at: page.getByRole("list", { name: "Documents" }), n: 2, side: "top" },
    {
      at: page.getByLabel("Fields of the document").locator("[aria-label]").first(),
      n: 3,
      side: "top",
    },
    { at: page.getByRole("button", { name: "Add filter" }).locator(".."), n: 4 },
  ]);
}

async function importFile(page: Page, id: string): Promise<void> {
  const file = join(tmpdir(), "new-customers.csv");
  writeFileSync(file, `${CSV}\n`);
  await page.goto(`/projects/demo/adapters/${id}/imports?table=${TABLE}`);
  await settle(page);
  await page.locator("input[type=file]").setInputFiles(file);
  await settle(page);
  await page.getByRole("button", { name: "Check the file" }).click();
  await page
    .getByText(/look ready to import|rows? (has|have) a problem/)
    .waitFor({ timeout: 30_000 });
  await fit(page);
  const selects = page.locator("main select");
  await shoot(page, "18-import", [
    { at: page.locator("input[type=file]"), n: 1 },
    { at: selects.nth(0), n: 2 },
    { at: selects.nth(1), n: 3 },
    { at: page.locator("main table").first(), n: 4 },
    { at: page.getByRole("button", { name: "Check the file" }), n: 5, side: "top" },
    { at: page.getByText(/look ready to import/), n: 6 },
    { at: page.getByRole("button", { name: "Import", exact: true }), n: 7, side: "top" },
  ]);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const done = page.getByText(/^Imported \d+ rows?\./);
  await done.waitFor({ timeout: 60_000 });
  await settle(page);
  await fit(page);
  await shoot(page, "19-import-done", [{ at: done, n: 1 }]);
}

export async function captureDataScreens(page: Page, state: string): Promise<void> {
  const postgres = await adapterId(page, "postgres");
  await databases(page);
  await adapter(page, postgres);
  await grid(page, postgres);
  await query(page, postgres);
  await documents(page, await adapterId(page, "mongodb"));
  await importFile(page, postgres);
  await captureHistoryScreens(page, state, await adapterId(page, "s3"));
}
