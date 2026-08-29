import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { importReportSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { S3, createSettled } from "../../../test/adapters.ts";
import { MAPPING, createImportsHarness, runToReport } from "../../../test/imports-harness.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import type { ImportRunRequest } from "./imports.service.ts";
import { readXlsx, writeXlsx } from "../../lib/xlsx/index.ts";

describe("import sources", () => {
  it("imports a CSV from a storage adapter and removes the fetched copy", async () => {
    const h = await createImportsHarness();
    const s3 = await createSettled(h.harness, S3);
    const tree: MemoryTree = new Map();
    tree.set("drops/customers.csv", {
      bytes: new TextEncoder().encode("Email\n C@X.IO \n"),
      modified_at: "2026-08-28T00:00:00.000Z",
    });
    h.harness.trees.set("exports", tree);
    const mapping = await h.imports.createMapping(h.harness.qa, h.adapterId, MAPPING);
    const request: ImportRunRequest = {
      adapter_id: h.adapterId,
      mapping_id: mapping.id,
      source: { adapter_id: s3.id, path: "drops/customers.csv" },
      dry_run: false,
      foreign_key_checks: true,
    };
    const job = await h.imports.run(h.harness.qa, "shop", request, TEST_META);
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    expect(v.parse(importReportSchema, done.result)).toMatchObject({ inserted: 1, failed: 0 });
    expect(h.harness.databases.get("shop")?.get("public.customers")?.length).toBe(3);
    expect(existsSync(join(h.harness.dataDir, "imports", "sources"))).toBe(true);
    expect(readdirSync(join(h.harness.dataDir, "imports", "sources"))).toEqual([]);
    await expect(
      h.imports.run(
        h.harness.qa,
        "shop",
        { ...request, source: { adapter_id: s3.id, path: "drops/nope.csv" } },
        TEST_META
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("builds a sample with a header, an example row, and a schema block", async () => {
    const h = await createImportsHarness();
    const sample = await h.imports.sample(h.adapterId, "public.customers", "csv", undefined);
    const lines = String(sample.body).trim().split("\n");
    expect(lines[0]).toBe("id,email");
    expect(lines[2]).toBe("# column, type, nullable, default, foreign key, required");
    const workbook = await h.imports.sample(h.adapterId, "public.customers", "xlsx", undefined);
    expect(workbook.fileName).toBe("sample-public.customers.xlsx");
    expect(
      readXlsx(new Uint8Array(v.parse(v.instance(Uint8Array), workbook.body))).rows[0]
    ).toEqual(sample.body.toString().split("\n")[0]?.split(","));
  });

  it("previews and imports an xlsx upload, naming its sheets", async () => {
    const h = await createImportsHarness();
    const bytes = writeXlsx("customers", [["Email"], [" X@X.IO "], ["y@x.io"]]);
    const upload = await h.imports.upload("shop", new File([bytes], "customers.xlsx"), "import");
    expect(upload.type).toBe("xlsx");
    const preview = await h.imports.preview("shop", { source: { upload_id: upload.upload_id } });
    expect(preview).toMatchObject({
      columns: ["Email"],
      rows: [[" X@X.IO "], ["y@x.io"]],
      sheets: ["customers"],
    });
    const mapping = await h.imports.createMapping(h.harness.qa, h.adapterId, MAPPING);
    const report = await runToReport(h, mapping, upload.upload_id);
    expect(report).toMatchObject({ inserted: 2, failed: 0 });
    expect(h.harness.databases.get("shop")?.get("public.customers")?.length).toBe(4);
  });
});
