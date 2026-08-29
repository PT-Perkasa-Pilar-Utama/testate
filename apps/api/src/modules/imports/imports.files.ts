import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Mapping, Preview, Project, TableSchema, Upload } from "@testate/shared";
import type { previewRequestSchema } from "@testate/shared";
import type * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { readCsv } from "./imports.csv.ts";
import type { ReadOptions } from "./imports.csv.ts";
import type { ImportsRepository, UploadRecord } from "./imports.repository.ts";
import { sampleCsv } from "./imports.sample.ts";

type PreviewRequest = v.InferOutput<typeof previewRequestSchema>;
type SourceFile = { path: string; uploadId: string | null };

export type FileDeps = {
  repo: ImportsRepository;
  dataDir: string;
  maxUploadBytes: number;
  now: () => Date;
  sourcePath: (project: Project, source: PreviewRequest["source"]) => SourceFile;
  tableOf: (adapter: AdapterRecord, target: string) => Promise<TableSchema>;
};

export type FileOps = {
  upload(project: Project, file: File, purpose: "import" | "archive"): Promise<Upload>;
  preview(project: Project, request: PreviewRequest): Promise<Preview>;
  sample(
    adapter: AdapterRecord,
    table: string,
    format: "csv" | "xlsx",
    mapping: Mapping | null
  ): Promise<{ fileName: string; body: string }>;
};

const UPLOAD_TTL_MS = 60 * 60 * 1000;
const PREVIEW_ROWS = 20;

function typeOf(name: string): Upload["type"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".tar")) return "tar";
  throw new AppError("VALIDATION_ERROR", "unsupported file type; use csv, xlsx, or tar", {
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
      const { path } = deps.sourcePath(project, request.source);
      const options: ReadOptions = {};
      if (request.options?.delimiter !== undefined) options.delimiter = request.options.delimiter;
      if (request.options?.header_row !== undefined) options.headerRow = request.options.header_row;
      const parsed = readCsv(await Bun.file(path).text(), options);
      return {
        columns: parsed.columns,
        rows: parsed.rows.slice(0, PREVIEW_ROWS),
        detected: { delimiter: parsed.delimiter, encoding: "utf-8", header_row: parsed.headerRow },
        typed_cells: false,
      };
    },
    async sample(adapter, table, format, mapping) {
      if (format === "xlsx") {
        throw new AppError("ENGINE_UNSUPPORTED", "xlsx samples are not available in this build", {
          reason: "format",
        });
      }
      return {
        fileName: `sample-${table}.csv`,
        body: sampleCsv(await deps.tableOf(adapter, table), mapping),
      };
    },
  };
}
