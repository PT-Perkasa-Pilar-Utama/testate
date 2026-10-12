import type { APIRequestContext } from "@playwright/test";

import { waitForJob } from "./api.ts";
import { deleteObject, writeObject } from "./bucket.ts";

/** A CSV of customers no other spec has, in the bucket, so the rows can only come from it. */
export function putCustomersCsv(path: string, emails: string[]): void {
  writeObject(path, ["email,balance", ...emails.map((email) => `${email},7.25`)].join("\n"));
}

export function removeStorageFile(path: string): void {
  deleteObject(path);
}

export type ImportReport = { inserted: number; updated: number; skipped: number; failed: number };

/** A normalizer that upserts a CSV's email and balance into `contract.customers`. */
export async function customersNormalizer(
  qa: APIRequestContext,
  adapterId: string,
  name: string
): Promise<string> {
  const created = await qa.post(`projects/demo/adapters/${adapterId}/normalizers`, {
    data: {
      name,
      target: "contract.customers",
      columns: [
        { source: "email", target: "email", transforms: [] },
        { source: "balance", target: "balance", transforms: [] },
      ],
      key_columns: ["email"],
      mode: "upsert",
    },
  });
  if (created.status() !== 201)
    throw new Error(`normalizer: ${created.status()} ${await created.text()}`);
  const body: { data: { id: string } } = await created.json();
  return body.data.id;
}

/** Runs an import whose source is a file on a storage adapter, and returns its finished report. */
export async function importFromStorage(
  qa: APIRequestContext,
  request: { adapterId: string; normalizerId: string; storageId: string; path: string }
): Promise<{ status: string; source: { kind?: string; ref?: string }; report: ImportReport }> {
  const started = await qa.post("projects/demo/imports", {
    data: {
      adapter_id: request.adapterId,
      normalizer_id: request.normalizerId,
      source: { adapter_id: request.storageId, path: request.path },
    },
  });
  if (started.status() !== 202)
    throw new Error(`import: ${started.status()} ${await started.text()}`);
  const job: { data: { id: string } } = await started.json();
  const finished = await waitForJob(qa, job.data.id);
  const runs: { data: { id: string; job_id: string; source: { kind?: string; ref?: string } }[] } =
    await (await qa.get("projects/demo/imports?limit=50")).json();
  const run = runs.data.find((item) => item.job_id === job.data.id);
  if (run === undefined) throw new Error(`no import run for job ${job.data.id}`);
  const report: { data: ImportReport } = await (
    await qa.get(`projects/demo/imports/${run.id}`)
  ).json();
  return { status: finished.status, source: run.source, report: report.data };
}
