import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Normalizer, Preview, Project, TableSchema, Upload } from "@testate/shared";
import type { previewRequestSchema } from "@testate/shared";
import type * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { writeXlsx } from "../../lib/xlsx/index.ts";
import { parseCsv } from "./imports.csv.ts";
import { isFetchedSource } from "./imports.job.ts";
import { readTable } from "./imports.table.ts";
import type { TableOptions } from "./imports.table.ts";
import type { ImportsRepository, UploadRecord } from "./imports.repository.ts";
import { sampleCsv } from "./imports.sample.ts";

type PreviewRequest = v.InferOutput<typeof previewRequestSchema>;
type SourceFile = { path: string; uploadId: string | null };

export type FileDeps = {
  repo: ImportsRepository;
  dataDir: string;
  maxUploadBytes: number;
  now: () => Date;
  sourcePath: (project: Project, source: PreviewRequest["source"]) => Promise<SourceFile>;
  tableOf: (adapter: AdapterRecord, target: string) => Promise<TableSchema>;
};

export type FileOps = {
  upload(project: Project, file: File, purpose: "import" | "archive"): Promise<Upload>;
  preview(project: Project, request: PreviewRequest): Promise<Preview>;
  sample(
    adapter: AdapterRecord,
    table: string,
    format: "csv" | "xlsx",
    normalizer: Normalizer | null
  ): Promise<{ fileName: string; body: string | Uint8Array }>;
};

const UPLOAD_TTL_MS = 60 * 60 * 1000;

function tableOptionsOf(options: PreviewRequest["options"]): TableOptions {
  const table: TableOptions = {};
  if (options?.delimiter !== undefined) table.delimiter = options.delimiter;
  if (options?.header_row !== undefined) table.headerRow = options.header_row;
  if (options?.sheet !== undefined) table.sheet = options.sheet;
  return table;
}
const PREVIEW_ROWS = 20;

function typeOf(name: string): Upload["type"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".tar")) return "tar";
  throw new AppError("VALIDATION_ERROR", "unsupported file type: use csv, xlsx, or tar", {
    file_name: name,
  });
}

function toPublic(upload: UploadRecord): Upload {
  return {
    upload_id: upload.upload_id,
    file_name: upload.file_name,
    size_bytes: upload.size_bytes,
    type: upload.type,
    expires_at: upload.expires_at,
  };
}

/** Uploads on disk under a random name, CSV preview, and schema samples (07 §7.1, 7.2, 7.7). */
export function createFileOps(deps: FileDeps): FileOps {
  return {
    async upload(project, file, purpose) {
      if (file.size > deps.maxUploadBytes) {
        throw new AppError("PAYLOAD_TOO_LARGE", "upload exceeds the limit", {
          limit_bytes: deps.maxUploadBytes,
        });
      }
      const type = typeOf(file.name);
      const id = Bun.randomUUIDv7();
      const dir = join(deps.dataDir, "uploads", id);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${Bun.randomUUIDv7()}.${type}`);
      await Bun.write(path, file);
      const record: UploadRecord = {
        upload_id: id,
        project_id: project.id,
        file_name: file.name,
        path,
        size_bytes: file.size,
        type,
        purpose,
        expires_at: new Date(deps.now().getTime() + UPLOAD_TTL_MS).toISOString(),
      };
      deps.repo.insertUpload({ ...record, created_at: deps.now().toISOString() });
      return toPublic(record);
    },
    async preview(project, request) {
      const { path, uploadId } = await deps.sourcePath(project, request.source);
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      if (uploadId === null && isFetchedSource(path))
        rmSync(dirname(path), { recursive: true, force: true });
      const parsed = readTable(bytes, tableOptionsOf(request.options));
      const preview: Preview = {
        columns: parsed.columns,
        rows: parsed.rows.slice(0, PREVIEW_ROWS),
        detected: { encoding: "utf-8", header_row: parsed.headerRow },
        typed_cells: false,
      };
      if (parsed.delimiter !== undefined) preview.detected.delimiter = parsed.delimiter;
      if (parsed.sheets !== undefined) preview.sheets = parsed.sheets;
      return preview;
    },
    async sample(adapter, table, format, normalizer) {
      const csv = sampleCsv(await deps.tableOf(adapter, table), normalizer);
      if (format === "xlsx") {
        return { fileName: `sample-${table}.xlsx`, body: writeXlsx("sample", parseCsv(csv, ",")) };
      }
      return { fileName: `sample-${table}.csv`, body: csv };
    },
  };
}
