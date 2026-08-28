import type { Entry, PreviewPayload } from "@testate/shared";

import { NOW } from "../../lib/mock/fixtures.ts";

export const ENTRIES_MOCK: Entry[] = [
  { name: "exports", path: "sit/exports", kind: "directory", size_bytes: null, modified_at: null },
  {
    name: "export-2026-08-28.csv",
    path: "sit/exports/export-2026-08-28.csv",
    kind: "file",
    size_bytes: 12345,
    modified_at: NOW,
  },
];

export const PREVIEW_CSV_MOCK: PreviewPayload = {
  kind: "csv",
  columns: ["order_id", "status"],
  rows: [["88213", "paid"]],
  truncated: false,
};
