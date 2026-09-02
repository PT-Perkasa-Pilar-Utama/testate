import type { ImportReport, ImportRun, Normalizer, Preview, Upload } from "@testate/shared";

import {
  ADAPTER_ID,
  ADMIN_ID,
  EARLIER,
  IMPORT_RUN_ID,
  JOB_ID,
  NORMALIZER_ID,
  NOW,
  QA_ACTOR,
  STASH_ID,
  UPLOAD_ID,
} from "../../lib/mock/fixtures.ts";

export const UPLOAD_MOCK: Upload = {
  upload_id: UPLOAD_ID,
  file_name: "customers.xlsx",
  size_bytes: 812345,
  type: "xlsx",
  expires_at: "2026-08-28T09:00:00.000Z",
};

export const PREVIEW_MOCK: Preview = {
  columns: ["Email", "Joined", "Password"],
  rows: [["a@b.c", "2026-01-31", "hunter2hunter2"]],
  sheets: ["Sheet1"],
  detected: { delimiter: ",", encoding: "utf-8", header_row: 1 },
  typed_cells: true,
};

export const NORMALIZER_MOCK: Normalizer = {
  id: NORMALIZER_ID,
  adapter_id: ADAPTER_ID,
  name: "customers-weekly",
  target: "public.customers",
  columns: [
    { source: "Email", target: "email", transforms: [{ kind: "trim" }, { kind: "lowercase" }] },
    {
      source: "Joined",
      target: "joined_at",
      transforms: [{ kind: "date", format: "dd/MM/yyyy", timezone: "Asia/Jakarta" }],
    },
    {
      source: "Password",
      target: "password_hash",
      transforms: [{ kind: "hash", algorithm: "bcrypt" }],
    },
    { source: null, target: "id", transforms: [{ kind: "uuid" }] },
  ],
  key_columns: ["email"],
  mode: "upsert",
  options: { delimiter: ",", header_row: 1, encoding: "utf-8" },
  created_by: ADMIN_ID,
  created_at: EARLIER,
  updated_at: NOW,
};

export const IMPORT_REPORT_MOCK: ImportReport = {
  run_id: IMPORT_RUN_ID,
  dry_run: false,
  inserted: 118,
  updated: 3,
  skipped: 0,
  failed: 2,
  duration_ms: 2140,
  errors_preview: [{ row_number: 12, reason: "joined_at: not a date" }],
  rejected_available: true,
  stash_state_id: STASH_ID,
};

export const IMPORT_RUN_MOCK: ImportRun = {
  id: IMPORT_RUN_ID,
  adapter_id: ADAPTER_ID,
  normalizer_id: NORMALIZER_ID,
  job_id: JOB_ID,
  source: { upload_id: UPLOAD_ID, file_name: "customers.xlsx" },
  dry_run: false,
  mode: "upsert",
  stash_state_id: STASH_ID,
  counts: { inserted: 118, updated: 3, skipped: 0, failed: 2, duration_ms: 2140 },
  rejected_available: true,
  actor: { ...QA_ACTOR },
  created_at: EARLIER,
  finished_at: NOW,
};
