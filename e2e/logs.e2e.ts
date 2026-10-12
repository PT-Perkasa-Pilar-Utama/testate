import { expect, test } from "@playwright/test";

import { apiContext, waitForJob } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import {
  MINIO,
  createBucketLogs,
  createIngest,
  createProject,
  deleteAdapter,
  deleteProject,
  downloadedLines,
  entries,
  logAdapter,
  messageOf,
  push,
  requestLines,
} from "./lib/logs.ts";
import { statePath } from "./lib/roles.ts";
import { deleteObject, writeObject } from "./lib/bucket.ts";

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
/** Every adapter here lives in this project, so no seeded job or screen grows a Logs menu. */
const SLUG = `logs-${STAMP}`;
const PREFIX = `logs-e2e-${STAMP}`;
const SECRET_LINE = "refund failed card=4242 token=abc123secret";

// One project for the file: its tests read it in order rather than racing to create it.
test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  const admin = await apiContext("admin");
  await createProject(admin, SLUG);
  await admin.dispose();
});

test.afterAll(async () => {
  const admin = await apiContext("admin");
  await deleteProject(admin, SLUG);
  await admin.dispose();
  deleteObject(`${PREFIX}/api-1.log`);
  deleteObject(`${PREFIX}/mask-1.log`);
});

test.describe("tester log stories", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-167 adds a log adapter over an S3 bucket from the Logs screen and reads it read-only", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const qa = await apiContext("qa");
    const line = { ts: new Date().toISOString(), level: "warn", message: `bucket line ${STAMP}` };
    writeObject(`${PREFIX}/api-1.log`, `${JSON.stringify(line)}\n`);
    const name = `bucket-${STAMP}`;

    await page.goto("/logs");
    await settle(page);
    await page.getByRole("button", { name: "New log adapter" }).click();
    await page.getByRole("button", { name: "Files over SFTP or S3" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByText(/^Read-only\./)).toBeVisible();
    await dialog.getByRole("combobox", { name: "Project", exact: true }).selectOption(SLUG);
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("combobox", { name: "Files over", exact: true }).selectOption("s3");
    await dialog.getByLabel("Bucket", { exact: true }).fill(MINIO.bucket);
    await dialog.getByLabel("Region", { exact: true }).fill(MINIO.region);
    await dialog.getByLabel(/^Endpoint/).fill(MINIO.endpoint);
    await dialog.getByLabel("Access key id", { exact: true }).fill(MINIO.access_key_id);
    await dialog.getByLabel("Secret access key", { exact: true }).fill(MINIO.secret_access_key);
    await dialog.getByLabel("Source name", { exact: true }).fill("api");
    await dialog.getByLabel("Files", { exact: true }).fill(`${PREFIX}/api-*.log`);
    await dialog.getByRole("combobox", { name: "Format", exact: true }).selectOption("json-lines");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // Listed under its project, and the API made it read-only whatever the dialog sent.
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    expect(await logAdapter(qa, name)).toMatchObject({ engine: "logfile", mode: "read_only" });
    await page.getByRole("link", { name, exact: true }).click();
    await settle(page);
    await expect(messageOf(entries(page).first())).toHaveText(line.message);
    await qa.dispose();
    expect(issues).toStrictEqual([]);
  });
});

test.describe("viewer log stories", () => {
  test.use({ storageState: statePath("viewer") });

  test("@story-168 reads a source newest first, filters by level and text, and pages back", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const qa = await apiContext("qa");
    const adapter = await createIngest(qa, SLUG, `read-${STAMP}`);
    await qa.dispose();
    // 250 lines: one page of 200 and an older page of 50.
    expect(await push(adapter, requestLines(250, "api"))).toBe(250);

    await page.goto(`/projects/${SLUG}/adapters/${adapter.id}`);
    await settle(page);
    await expect(entries(page)).toHaveCount(200);
    await expect(messageOf(entries(page).first())).toHaveText("request 249 ok");
    const more = page.getByRole("button", { name: "Load more" });
    await expect(more).toBeVisible();
    await more.click();
    await expect(entries(page)).toHaveCount(250);
    await expect(messageOf(entries(page).last())).toHaveText("checkout failed 0");
    await expect(page.getByText("The start of the log.")).toBeVisible();

    // "error and above": the five errors, newest first.
    await page.getByRole("combobox", { name: "Level", exact: true }).selectOption("error");
    await expect(entries(page)).toHaveCount(5);
    await expect(messageOf(entries(page).first())).toHaveText("checkout failed 200");
    await page.getByRole("combobox", { name: "Level", exact: true }).selectOption("");
    const contains = page.getByLabel("Contains", { exact: true });
    await contains.fill("request 123 ok");
    await contains.press("Enter");
    await contains.blur();
    await expect(entries(page)).toHaveCount(1);
    await expect(messageOf(entries(page).first())).toHaveText("request 123 ok");
    expect(issues).toStrictEqual([]);
  });

  test("@story-169 follows a source and sees a line pushed after the page opened", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const qa = await apiContext("qa");
    const adapter = await createIngest(qa, SLUG, `follow-${STAMP}`);
    await qa.dispose();
    await push(adapter, requestLines(3, "api"));

    await page.goto(`/projects/${SLUG}/adapters/${adapter.id}`);
    await settle(page);
    await expect(entries(page)).toHaveCount(3);
    const follow = page.getByRole("button", { name: "Follow" });
    await follow.click();
    await expect(page.getByRole("button", { name: "Following" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const late = `arrived while following ${STAMP}`;
    await push(adapter, [
      { ts: new Date().toISOString(), level: "info", message: late, service: { name: "api" } },
    ]);
    // Follow polls every 3 s; no reload, no click.
    await expect(messageOf(entries(page).first())).toHaveText(late, { timeout: 15_000 });
    await expect(entries(page)).toHaveCount(4);
    expect(issues).toStrictEqual([]);
  });

  test("@story-170 a job links to its project's logs over the run's window", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const qa = await apiContext("qa");
    const runName = `run-${STAMP}`;
    const run = await createIngest(qa, SLUG, runName);
    const during = `written during the run ${STAMP}`;
    await push(run, [
      { ts: new Date().toISOString(), level: "info", message: during, service: { name: "api" } },
    ]);
    // A project without databases still runs one job: deleting one of its adapters.
    const doomed = await createIngest(qa, SLUG, `doomed-${STAMP}`);
    const jobId = await deleteAdapter(qa, SLUG, doomed.id);
    expect((await waitForJob(qa, jobId)).status).toBe("succeeded");
    await qa.dispose();

    await page.goto("/jobs");
    await settle(page);
    // Only this project's job carries a link to its adapter, and the link sits in the job's row.
    const row = page.locator("tbody tr").filter({ has: page.locator("a", { hasText: runName }) });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Logs during this run" }).click();
    await row.getByRole("link", { name: runName, exact: true }).click();
    await settle(page);
    // An ingest adapter's sources are its services, unknown to the link, so the viewer opens on
    // the first one (`readLogQuery`); the window is what the link carries.
    await expect(page).toHaveURL(/[?&]from=[^&]+&to=[^&]+/);
    await expect(page.getByRole("combobox", { name: "Source", exact: true })).toHaveValue("api");
    await expect(messageOf(entries(page).first())).toHaveText(during);
    expect(issues).toStrictEqual([]);
  });

  test("@story-171 a viewer sees secrets masked and downloads them masked; a tester sees them raw", async ({
    page,
    browser,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const qa = await apiContext("qa");
    const line = { ts: new Date().toISOString(), level: "error", message: SECRET_LINE };
    writeObject(`${PREFIX}/mask-1.log`, `${JSON.stringify(line)}\n`);
    // `card=\d+` is the source's own pattern; `token=` is a built-in one.
    const id = await createBucketLogs(qa, SLUG, `mask-${STAMP}`, `${PREFIX}/mask-*.log`, [
      "card=\\d+",
    ]);
    await qa.dispose();
    const masked = "refund failed *** token=***";

    await page.goto(`/projects/${SLUG}/adapters/${id}`);
    await settle(page);
    const entry = entries(page).first();
    await expect(messageOf(entry)).toHaveText(masked);
    await expect(entry.getByText("masked", { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    expect(await downloadedLines(await download)).toMatchObject([
      { message: masked, masked: true },
    ]);
    expect(issues).toStrictEqual([]);

    const tester = await browser.newContext({ storageState: statePath("qa") });
    const qaPage = await tester.newPage();
    await qaPage.goto(`/projects/${SLUG}/adapters/${id}`);
    await settle(qaPage);
    await expect(messageOf(entries(qaPage).first())).toHaveText(SECRET_LINE);
    await expect(entries(qaPage).first().getByText("masked", { exact: true })).toHaveCount(0);
    await tester.close();
  });
});
