import { expect, test } from "@playwright/test";

import { apiContext } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import {
  SHOP_POSTGRES,
  adapterNamed,
  adapterNames,
  codeOf,
  inspectProject,
  policiesOf,
  projectWithDatabase,
  removeAdapter,
  savedQueryNames,
  tokenNamed,
} from "./lib/inspect.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

// Both stories add to the one Inspect project; on one worker neither sees the other half done.
test.describe.configure({ mode: "default" });

test.describe("the Inspect project", () => {
  test.use({ storageState: statePath("admin") });

  test("@story-155 adds a database read-only to Inspect, makes its agent token in one click, and finds nothing that writes", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const admin = await apiContext("admin");
    const inspect = await inspectProject(admin);
    const name = `look-${STAMP}`;

    // Added from the Databases menu with Inspect picked: the dialog has no mode, only the promise.
    await page.goto(`/databases?project=${inspect.slug}`);
    await settle(page);
    await page.getByRole("button", { name: "New database" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByText("Read-only. Testate never writes here.")).toBeVisible();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Host").fill(SHOP_POSTGRES.host);
    await dialog.getByLabel("Port").fill(String(SHOP_POSTGRES.port));
    await dialog.getByRole("textbox", { name: "Database" }).fill(SHOP_POSTGRES.database);
    await dialog.getByLabel("User").fill(SHOP_POSTGRES.user);
    await dialog.getByLabel("Password").fill(SHOP_POSTGRES.password);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const adapter = await adapterNamed(admin, inspect.slug, name);
    expect(adapter.mode).toBe("read_only");

    // One click from the Inspect page opens the token dialog already set to an Inspect agent.
    await page.goto(`/projects/${inspect.slug}`);
    await settle(page);
    await expect(page.getByText("Built in · read-only").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Snapshot" })).toHaveCount(0);
    await page.getByRole("link", { name: "Make an agent token" }).click();
    const tokenDialog = page.locator("dialog[open]");
    await expect(tokenDialog.getByText("A token that reaches Inspect is a Guest.")).toBeVisible();
    await tokenDialog.getByLabel("Name").fill(`agent-${STAMP}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText(/tst_/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    const token = await tokenNamed(admin, `agent-${STAMP}`);
    expect([token.kind, token.role, token.project_ids]).toStrictEqual([
      "agent",
      "viewer",
      [inspect.id],
    ]);

    // Its table screen reads, and offers neither an import nor a write mode.
    const tables: { data: { tables: { schema: string | null; name: string }[] } } = await (
      await admin.get(`projects/${inspect.slug}/adapters/${adapter.id}/schema`)
    ).json();
    expect(tables.data.tables.map((table) => table.name)).toContain("customers");
    await page.goto(
      `/projects/${inspect.slug}/adapters/${adapter.id}/tables/${encodeURIComponent("contract.customers")}`
    );
    await settle(page);
    await expect(page.getByRole("columnheader", { name: /email/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Import a file" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Write mode" })).toHaveCount(0);

    // The API refuses what the screen does not offer, whoever asks.
    const snapshot = await admin.post(`projects/${inspect.slug}/states`, {
      data: { name: `never-${STAMP}`, adapter_ids: [adapter.id] },
    });
    expect([snapshot.status(), await codeOf(snapshot)]).toStrictEqual([403, "PROJECT_READ_ONLY"]);

    await admin.delete(`tokens/${token.id}`);
    expect(await removeAdapter(admin, inspect.slug, adapter.id)).toBe("succeeded");
    await admin.dispose();
    expect(issues).toStrictEqual([]);
  });
});

test.describe("moving an adapter", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-158 moves a database into Inspect and it keeps its policies and saved queries", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const qa = await apiContext("qa");
    const from = `move-${STAMP}`;
    // Its own project and adapter: a seeded demo adapter moved away would break every later spec.
    const adapter = await projectWithDatabase(qa, from, `moving-${STAMP}`);
    const base = `projects/${from}/adapters/${adapter.id}`;
    const policy = await qa.put(
      `${base}/policies/${encodeURIComponent("contract.customers")}/email`,
      {
        data: { required_function: null, mask: "redact" },
      }
    );
    expect(policy.status()).toBe(200);
    const saved = await qa.post(`${base}/saved-queries`, {
      data: { name: `saved-${STAMP}`, body: { sql: "select email from contract.customers" } },
    });
    expect(saved.status()).toBe(201);
    const inspect = await inspectProject(qa);

    await page.goto(`/${base}`);
    await settle(page);
    await page.getByRole("button", { name: "Move to project…" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel(/To project/).selectOption({ label: "Inspect" });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${inspect.slug}/adapters/${adapter.id}$`));

    // Same id, now read-only in Inspect, gone from where it was, and everything attached came along.
    const moved = await adapterNamed(qa, inspect.slug, `moving-${STAMP}`);
    expect([moved.id, moved.mode]).toStrictEqual([adapter.id, "read_only"]);
    expect(await adapterNames(qa, from)).toStrictEqual([]);
    expect(await policiesOf(qa, inspect.slug, adapter.id)).toContain(
      "contract.customers.email redact"
    );
    expect(await savedQueryNames(qa, inspect.slug, adapter.id)).toContain(`saved-${STAMP}`);

    expect(await removeAdapter(qa, inspect.slug, adapter.id)).toBe("succeeded");
    await qa.dispose();
    expect(issues).toStrictEqual([]);
  });
});
