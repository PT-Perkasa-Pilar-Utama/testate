import * as v from "valibot";
import type {
  ImportReport,
  ImportRun,
  Job,
  JsonObject,
  Mapping,
  Preview,
  Upload,
} from "@testate/shared";
import {
  importReportSchema,
  importRunSchema,
  jobSchema,
  mappingSchema,
  previewSchema,
  uploadSchema,
} from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const project = (slug: string): string => `/projects/${encodeURIComponent(slug)}`;
const adapter = (slug: string, id: string): string =>
  `${project(slug)}/adapters/${encodeURIComponent(id)}`;

export const importsModel = {
  list: (slug: string): Promise<ImportRun[]> =>
    apiClient.get(`${project(slug)}/imports`, { schema: v.array(importRunSchema) }),
  upload: (slug: string, file: File): Promise<Upload> =>
    apiClient.upload(`${project(slug)}/uploads`, file, { purpose: "import" }, uploadSchema),
  preview: (slug: string, body: JsonObject): Promise<Preview> =>
    apiClient.post(`${project(slug)}/imports/preview`, { schema: previewSchema, body }),
  mappings: (slug: string, adapterId: string): Promise<Mapping[]> =>
    apiClient.get(`${adapter(slug, adapterId)}/mappings`, { schema: v.array(mappingSchema) }),
  createMapping: (slug: string, adapterId: string, body: JsonObject): Promise<Mapping> =>
    apiClient.post(`${adapter(slug, adapterId)}/mappings`, { schema: mappingSchema, body }),
  run: (slug: string, body: JsonObject): Promise<Job> =>
    apiClient.post(`${project(slug)}/imports`, { schema: jobSchema, body }),
  report: (slug: string, runId: string): Promise<ImportReport> =>
    apiClient.get(`${project(slug)}/imports/${encodeURIComponent(runId)}`, {
      schema: importReportSchema,
    }),
  rejectedUrl: (slug: string, runId: string): string =>
    apiClient.url(`${project(slug)}/imports/${encodeURIComponent(runId)}/rejected`),
  sampleUrl: (slug: string, adapterId: string, table: string, format: "csv" | "xlsx"): string =>
    apiClient.url(`${adapter(slug, adapterId)}/tables/${encodeURIComponent(table)}/sample`, {
      format,
    }),
};
