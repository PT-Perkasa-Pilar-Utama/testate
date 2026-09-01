import * as v from "valibot";
import type { Entry, PreviewPayload } from "@testate/shared";
import { entrySchema, previewPayloadSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export type EntriesPage = { data: Entry[]; page: { next_cursor: string | null } };
export type EntriesQuery = { path: string; cursor?: string; q?: string; limit: number };

const pageSchema = v.object({
  data: v.array(entrySchema),
  page: v.object({ next_cursor: v.nullable(v.string()) }),
});

const adapterPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}`;

function entriesQuery(query: EntriesQuery): string {
  const params = new URLSearchParams({ path: query.path, limit: String(query.limit) });
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  return `?${params.toString()}`;
}

/** Binary previews (images, PDF) render in a sandboxed frame straight from the API (11 §11.3). */
export const BINARY_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf"]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export const storageModel = {
  entries: (slug: string, id: string, query: EntriesQuery): Promise<EntriesPage> =>
    apiClient.envelope(`${adapterPath(slug, id)}/entries${entriesQuery(query)}`, {
      schema: pageSchema,
    }),
  preview: (slug: string, id: string, path: string): Promise<PreviewPayload> =>
    apiClient.get(`${adapterPath(slug, id)}/entries/preview`, {
      query: { path },
      schema: previewPayloadSchema,
    }),
  /** Absolute API URLs for the browser to open directly (cookies carry the session). */
  previewUrl: (slug: string, id: string, path: string): string =>
    apiClient.url(`${adapterPath(slug, id)}/entries/preview`, { path }),
  downloadUrl: (slug: string, id: string, path: string): string =>
    apiClient.url(`${adapterPath(slug, id)}/entries/download`, { path }),
  upload: (slug: string, id: string, path: string, file: File): Promise<Entry> =>
    apiClient.upload(
      `${adapterPath(slug, id)}/entries?path=${encodeURIComponent(path)}`,
      file,
      {},
      entrySchema
    ),
  remove: (slug: string, id: string, path: string): Promise<undefined> =>
    apiClient.delete(`${adapterPath(slug, id)}/entries`, {
      schema: v.undefined(),
      query: { path },
    }),
  acceptHostKey: (slug: string, id: string, fingerprint: string): Promise<undefined> =>
    apiClient.post(`${adapterPath(slug, id)}/host-key/accept`, {
      schema: v.undefined(),
      body: { fingerprint },
    }),
};
