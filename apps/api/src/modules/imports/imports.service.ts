import type { ImportReport, ImportRun, Job, Mapping, Preview, Upload } from "@testate/shared";

import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import { ADAPTER_ID } from "../../lib/mock/fixtures.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import {
  IMPORT_REPORT_MOCK,
  IMPORT_RUN_MOCK,
  MAPPING_MOCK,
  PREVIEW_MOCK,
  UPLOAD_MOCK,
} from "./imports.mock.ts";

export type ImportsService = {
  upload(fileName: string, sizeBytes: number, maxBytes: number): Promise<Upload>;
  preview(): Promise<Preview>;
  listMappings(adapterId: string): Promise<Mapping[]>;
  createMapping(adapterId: string, name: string, target: string): Promise<Mapping>;
  getMapping(adapterId: string, id: string): Promise<Mapping>;
  updateMapping(adapterId: string, id: string): Promise<Mapping>;
  removeMapping(adapterId: string, id: string): Promise<void>;
  run(slug: string, adapterId: string, mappingId: string, dryRun: boolean): Promise<Job>;
  listRuns(slug: string): Promise<ImportRun[]>;
  report(slug: string, runId: string): Promise<ImportReport>;
  rejectedRows(slug: string, runId: string): Promise<string>;
  sample(
    adapterId: string,
    table: string,
    format: "csv" | "xlsx"
  ): Promise<{ fileName: string; body: string }>;
};

function requireTabular(adapterId: string): void {
  if (adapterId !== ADAPTER_ID) {
    throw new AppError("ENGINE_UNSUPPORTED", "imports need a Tabular adapter", { reason: "tier" });
  }
}

/** SCAFFOLD: one mapping and one run. The imports card wires parsers, transforms, and the engine. */
export function createImportsService(): ImportsService {
  return {
    async upload(fileName, sizeBytes, maxBytes) {
      if (sizeBytes > maxBytes)
        throw new AppError("PAYLOAD_TOO_LARGE", "upload exceeds the limit", {
          limit_bytes: maxBytes,
        });
      return { ...UPLOAD_MOCK, file_name: fileName, size_bytes: sizeBytes };
    },
    async preview() {
      return PREVIEW_MOCK;
    },
    async listMappings(adapterId) {
      requireTabular(adapterId);
      return [MAPPING_MOCK];
    },
    async createMapping(adapterId, name, target) {
      requireTabular(adapterId);
      if (name.toLowerCase() === MAPPING_MOCK.name)
        throw conflict("mapping name is taken", { name });
      return { ...MAPPING_MOCK, id: Bun.randomUUIDv7(), name, target };
    },
    async getMapping(adapterId, id) {
      requireTabular(adapterId);
      if (id !== MAPPING_MOCK.id) throw notFound("mapping");
      return MAPPING_MOCK;
    },
    async updateMapping(adapterId, id) {
      requireTabular(adapterId);
      if (id !== MAPPING_MOCK.id) throw notFound("mapping");
      return MAPPING_MOCK;
    },
    async removeMapping(adapterId, id) {
      requireTabular(adapterId);
      if (id !== MAPPING_MOCK.id) throw notFound("mapping");
    },
    async run(slug, adapterId, mappingId, dryRun) {
      if (slug !== "shop") throw notFound("project");
      requireTabular(adapterId);
      if (mappingId !== MAPPING_MOCK.id) throw notFound("mapping");
      return {
        ...PROJECT_JOB_MOCK,
        kind: "import",
        status: "queued",
        finished_at: null,
        result: { dry_run: dryRun },
      };
    },
    async listRuns(slug) {
      if (slug !== "shop") throw notFound("project");
      return [IMPORT_RUN_MOCK];
    },
    async report(slug, runId) {
      if (slug !== "shop") throw notFound("project");
      if (runId !== IMPORT_RUN_MOCK.id) throw notFound("import run");
      return IMPORT_REPORT_MOCK;
    },
    async rejectedRows(slug, runId) {
      await this.report(slug, runId);
      return "Email,Joined,Password,row_number,reason\na@b.c,31/13/2026,***,12,joined_at: not a date\n";
    },
    async sample(adapterId, table, format) {
      requireTabular(adapterId);
      const header = "email,joined_at,password_hash";
      const example = "example@example.com,2026-01-31,example";
      const schema =
        "# column, type, nullable, default, foreign key, required\n# email, text, no, , , yes\n# joined_at, date, yes, , , no\n# password_hash, text, no, , , yes (hash_bcrypt)";
      return { fileName: `sample-${table}.${format}`, body: `${header}\n${example}\n${schema}\n` };
    },
  };
}
