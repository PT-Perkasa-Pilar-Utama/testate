import type {
  Actor,
  ImportReport,
  ImportRun,
  Job,
  Normalizer,
  Preview,
  Upload,
  importRunRequestSchema,
  normalizerBodySchema,
  previewRequestSchema,
} from "@testate/shared";
import type * as v from "valibot";

import type { RequestMeta } from "../../lib/http/auth.ts";
import type { RunsFilter } from "./imports.repository.ts";

export type NormalizerBody = v.InferOutput<typeof normalizerBodySchema>;
export type PreviewRequest = v.InferOutput<typeof previewRequestSchema>;
export type ImportRunRequest = v.InferOutput<typeof importRunRequestSchema>;

export type ImportsService = {
  assertAdapter(projectSlug: string, adapterId: string): void;
  upload(slug: string, file: File, purpose: "import" | "archive"): Promise<Upload>;
  preview(slug: string, request: PreviewRequest): Promise<Preview>;
  listNormalizers(adapterId: string): Promise<Normalizer[]>;
  createNormalizer(actor: Actor, adapterId: string, body: NormalizerBody): Promise<Normalizer>;
  getNormalizer(adapterId: string, id: string): Promise<Normalizer>;
  updateNormalizer(
    adapterId: string,
    id: string,
    patch: Partial<NormalizerBody>
  ): Promise<Normalizer>;
  removeNormalizer(adapterId: string, id: string): Promise<void>;
  run(actor: Actor, slug: string, request: ImportRunRequest, meta: RequestMeta): Promise<Job>;
  listRuns(slug: string, filter: RunsFilter): Promise<ImportRun[]>;
  report(slug: string, runId: string): Promise<ImportReport>;
  rejectedRows(slug: string, runId: string): Promise<string>;
  sample(
    adapterId: string,
    table: string,
    format: "csv" | "xlsx",
    normalizerId: string | undefined
  ): Promise<{ fileName: string; body: string | Uint8Array }>;
};
