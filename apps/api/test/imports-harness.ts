import { expect } from "bun:test";
import type { ImportReport, Mapping } from "@testate/shared";
import { importReportSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "./accounts.ts";
import { PG, createAdaptersHarness, createSettled } from "./adapters.ts";
import type { AdaptersHarness } from "./adapters.ts";
import { createImportsService } from "../src/modules/imports/imports.service.ts";
import type {
  ImportRunRequest,
  ImportsService,
  MappingBody,
} from "../src/modules/imports/imports.service.ts";

export type ImportsHarness = {
  harness: AdaptersHarness;
  imports: ImportsService;
  adapterId: string;
};

export async function createImportsHarness(): Promise<ImportsHarness> {
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

export const MAPPING: MappingBody = {
  name: "customers",
  target: "public.customers",
  columns: [
    { source: "Email", target: "email", transforms: [{ kind: "trim" }, { kind: "lowercase" }] },
  ],
  key_columns: ["email"],
  mode: "upsert",
  options: {},
};

export async function uploadCsv(h: ImportsHarness, text: string): Promise<string> {
  const upload = await h.imports.upload("shop", new File([text], "customers.csv"), "import");
  return upload.upload_id;
}

export async function runToReport(
  h: ImportsHarness,
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
