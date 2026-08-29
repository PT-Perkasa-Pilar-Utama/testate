import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  importReportSchema,
  importRunSchema,
  mappingSchema,
  previewSchema,
  uploadSchema,
} from "@testate/shared";
import type { ImportReport, Mapping } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, S3, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { detectDelimiter, parseCsv, readCsv } from "./imports.csv.ts";
import {
  IMPORT_REPORT_MOCK,
  IMPORT_RUN_MOCK,
  MAPPING_MOCK,
  PREVIEW_MOCK,
  UPLOAD_MOCK,
} from "./imports.mock.ts";
import { createImportsService } from "./imports.service.ts";
import type { ImportRunRequest, ImportsService, MappingBody } from "./imports.service.ts";
import { applyTransforms } from "./imports.transforms.ts";

type Harness = { harness: AdaptersHarness; imports: ImportsService; adapterId: string };

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const adapter = await createSettled(harness, PG);
  const imports = createImportsService({
    repo: harness.imports,
    adapters: harness.repo,
    policies: harness.policies,
    projects: harness.projectsRepo,
    engines: harness.engines,
    ring: harness.ring,
    files: harness.files,
    jobs: harness.runtime.jobs,
    audit: harness.audit,
    dataDir: harness.dataDir,
    maxUploadBytes: 1024 * 1024,
    now: harness.now,
  });
  return { harness, imports, adapterId: adapter.id };
}

const MAPPING: MappingBody = {
  name: "customers",
  target: "public.customers",
  columns: [
    { source: "Email", target: "email", transforms: [{ kind: "trim" }, { kind: "lowercase" }] },
  ],
  key_columns: ["email"],
  mode: "upsert",
  options: {},
};

async function uploadCsv(h: Harness, text: string): Promise<string> {
  const upload = await h.imports.upload("shop", new File([text], "customers.csv"), "import");
  return upload.upload_id;
}

async function runToReport(
  h: Harness,
  mapping: Mapping,
  uploadId: string,
  extra: { dry_run?: boolean; mode?: "append" | "upsert" | "replace" } = {}
): Promise<ImportReport> {
  const request: ImportRunRequest = {
    adapter_id: h.adapterId,
    mapping_id: mapping.id,
    source: { upload_id: uploadId },
    dry_run: extra.dry_run ?? false,
    foreign_key_checks: true,
  };
  if (extra.mode !== undefined) request.mode = extra.mode;
  const job = await h.imports.run(h.harness.qa, "shop", request, TEST_META);
  const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
  expect(done.error).toBeNull();
  return v.parse(importReportSchema, done.result);
}

describe("imports", () => {
  it("mocks match the contract", () => {
    expectContract(uploadSchema, UPLOAD_MOCK, (clone) => {
      clone["type"] = "pdf";
    });
    expectContract(previewSchema, PREVIEW_MOCK, (clone) => {
      clone["detected"] = {};
    });
    expectContract(mappingSchema, MAPPING_MOCK, (clone) => {
      clone["columns"] = [{ source: "Email", target: "email", transforms: [{ kind: "explode" }] }];
    });
    expectContract(importReportSchema, IMPORT_REPORT_MOCK, (clone) => {
      clone["inserted"] = "many";
    });
    expectContract(importRunSchema, IMPORT_RUN_MOCK, (clone) => {
      clone["mode"] = "merge";
    });
  });

  it("parses CSV with quotes, embedded newlines, a BOM, and detects the delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(parseCsv('a,"b ""q""",c\n1,"x\ny",3\n', ",")).toEqual([
      ["a", 'b "q"', "c"],
      ["1", "x\ny", "3"],
    ]);
    const table = readCsv("﻿Email,Joined\r\na@x.io,2026-01-31\r\n", {});
    expect(table.columns).toEqual(["Email", "Joined"]);
    expect(table.rows).toEqual([["a@x.io", "2026-01-31"]]);
    expect(() => parseCsv('a,"unterminated', ",")).toThrow("unterminated quoted field");
  });

  it("applies transforms in order and reports bad values", async () => {
    expect(await applyTransforms("  A@X.IO ", [{ kind: "trim" }, { kind: "lowercase" }])).toBe(
      "a@x.io"
    );
    expect(await applyTransforms("31/01/2026", [{ kind: "date", format: "dd/MM/yyyy" }])).toBe(
      "2026-01-31"
    );
    expect(await applyTransforms("1.234,50", [{ kind: "number", locale: "id-ID" }])).toBe(1234.5);
    expect(
      await applyTransforms("yes", [{ kind: "boolean", trueValues: ["yes"], falseValues: ["no"] }])
    ).toBe(true);
    expect(await applyTransforms("", [{ kind: "emptyToNull" }, { kind: "uppercase" }])).toBeNull();
    await expect(applyTransforms("x", [{ kind: "number" }])).rejects.toThrow("not a number");
    expect(
      String(await applyTransforms("pw", [{ kind: "hash", algorithm: "sha256" }]))
    ).toHaveLength(64);
  });

  it("validates mappings against the live schema and column policies", async () => {
    const h = await createHarness();
    await expect(
      h.imports.createMapping(h.harness.qa, h.adapterId, {
        ...MAPPING,
        columns: [{ source: "X", target: "nope", transforms: [] }],
        key_columns: [],
      })
    ).rejects.toThrow("unknown target column nope");
    await expect(
      h.imports.createMapping(h.harness.qa, h.adapterId, { ...MAPPING, key_columns: [] })
    ).rejects.toThrow("upsert needs key_columns");
    h.harness.policies.upsert(
      h.adapterId,
      {
        table: "public.customers",
        column: "email",
        required_function: { name: "hash_sha256" },
        mask: null,
        display: false,
      },
      h.harness.qa.id,
      "2026-08-29T00:00:00.000Z"
    );
    await expect(h.imports.createMapping(h.harness.qa, h.adapterId, MAPPING)).rejects.toThrow(
      "email requires the hash_sha256 function"
    );
    const hashed = await h.imports.createMapping(h.harness.qa, h.adapterId, {
      ...MAPPING,
      columns: [
        { source: "Email", target: "email", transforms: [{ kind: "hash", algorithm: "sha256" }] },
      ],
    });
    expect(hashed.mode).toBe("upsert");
    await expect(
      h.imports.createMapping(h.harness.qa, h.adapterId, {
        ...MAPPING,
        name: "Customers",
        columns: hashed.columns,
      })
    ).rejects.toThrow("mapping name is taken");
  });

  it("previews an upload, dry-runs without writing, and reports row errors", async () => {
    const h = await createHarness();
    const mapping = await h.imports.createMapping(h.harness.qa, h.adapterId, MAPPING);
    const uploadId = await uploadCsv(h, "Email\n C@X.IO \n\nfail@x.io\n");
    const preview = await h.imports.preview("shop", { source: { upload_id: uploadId } });
    expect(preview.columns).toEqual(["Email"]);
    expect(preview.rows.length).toBe(2);
    const report = await runToReport(h, mapping, uploadId, { dry_run: true });
    expect(report).toMatchObject({
      dry_run: true,
      inserted: 0,
      skipped: 2,
      failed: 0,
      stash_state_id: null,
    });
    expect(h.harness.databases.get("shop")?.get("public.customers")?.length).toBe(2);
    await expect(
      h.imports.preview("shop", { source: { upload_id: uploadId } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("upserts by key, writes rejected rows with reasons, and re-imports them", async () => {
    const h = await createHarness();
    const mapping = await h.imports.createMapping(h.harness.qa, h.adapterId, MAPPING);
    const report = await runToReport(
      h,
      mapping,
      await uploadCsv(h, "Email\nA@X.IO\nc@x.io\nfail@x.io\n")
    );
    expect(report).toMatchObject({
      inserted: 1,
      updated: 1,
      failed: 1,
      rejected_available: true,
      stash_state_id: null,
    });
    expect(report.errors_preview[0]).toMatchObject({ row_number: 4 });
    const rejected = await h.imports.rejectedRows("shop", report.run_id);
    expect(rejected.split("\n")[0]).toBe("Email,row_number,reason");
    expect(rejected).toContain("fail@x.io,4,");
    const runs = await h.imports.listRuns("shop", { limit: 10 });
    expect(runs.map((run) => run.rejected_available)).toEqual([true]);
    const again = await h.imports.run(
      h.harness.qa,
      "shop",
      {
        adapter_id: h.adapterId,
        mapping_id: mapping.id,
        source: { rejected_of_run_id: report.run_id },
        dry_run: true,
        foreign_key_checks: true,
      },
      TEST_META
    );
    const done = await h.harness.runtime.jobs.wait(null, again.id, 5);
    expect(v.parse(importReportSchema, done.result).skipped).toBe(1);
  });

  it("replace stashes first, empties the table, and refuses real runs on read-only adapters", async () => {
    const h = await createHarness();
    const mapping = await h.imports.createMapping(h.harness.qa, h.adapterId, {
      ...MAPPING,
      mode: "append",
      key_columns: [],
    });
    const report = await runToReport(h, mapping, await uploadCsv(h, "Email\nz@x.io\n"), {
      mode: "replace",
    });
    expect(report.stash_state_id).not.toBeNull();
    expect(h.harness.databases.get("shop")?.get("public.customers")).toEqual([
      { id: 1, email: "z@x.io" },
    ]);
    await h.harness.adapters.setMode(h.harness.qa, "shop", h.adapterId, "read_only", TEST_META);
    await expect(
      h.imports.run(
        h.harness.qa,
        "shop",
        {
          adapter_id: h.adapterId,
          mapping_id: mapping.id,
          source: { upload_id: await uploadCsv(h, "Email\n") },
          dry_run: false,
          foreign_key_checks: true,
        },
        TEST_META
      )
    ).rejects.toMatchObject({ code: "ADAPTER_READ_ONLY" });
  });

  it("imports a CSV from a storage adapter and removes the fetched copy", async () => {
    const h = await createHarness();
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
    const h = await createHarness();
    const sample = await h.imports.sample(h.adapterId, "public.customers", "csv", undefined);
    const lines = sample.body.trim().split("\n");
    expect(lines[0]).toBe("id,email");
    expect(lines[2]).toBe("# column, type, nullable, default, foreign key, required");
    await expect(
      h.imports.sample(h.adapterId, "public.customers", "xlsx", undefined)
    ).rejects.toMatchObject({ code: "ENGINE_UNSUPPORTED" });
  });
});
