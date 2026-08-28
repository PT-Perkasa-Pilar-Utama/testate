import type { Entry, PreviewPayload } from "@testate/shared";

import { AppError, notFound } from "../../lib/http/index.ts";
import { STORAGE_ADAPTER_ID } from "../../lib/mock/fixtures.ts";
import { ENTRIES_MOCK, PREVIEW_CSV_MOCK } from "./storage.mock.ts";

export type StorageService = {
  list(adapterId: string, path: string | undefined, q: string | undefined): Promise<Entry[]>;
  stat(adapterId: string, path: string): Promise<Entry>;
  preview(adapterId: string, path: string): Promise<PreviewPayload>;
  download(adapterId: string, path: string): Promise<{ body: string; contentType: string }>;
  acceptHostKey(adapterId: string, fingerprint: string): Promise<void>;
};

function requireFiles(adapterId: string): void {
  if (adapterId !== STORAGE_ADAPTER_ID) {
    throw new AppError("ENGINE_UNSUPPORTED", "browsing needs a Files adapter", { reason: "tier" });
  }
}

/** SCAFFOLD: one bucket with one export. The storage card wires lib/files (S3, SFTP, FTP). */
export function createStorageService(): StorageService {
  const find = (adapterId: string, path: string): Entry => {
    requireFiles(adapterId);
    const entry = ENTRIES_MOCK.find((item) => item.path === path);
    if (entry === undefined) throw notFound("entry");
    return entry;
  };
  return {
    async list(adapterId, path, q) {
      requireFiles(adapterId);
      const inDir =
        path === undefined || path === ""
          ? ENTRIES_MOCK
          : ENTRIES_MOCK.filter((entry) => entry.path.startsWith(`${path}/`));
      return q === undefined ? inDir : inDir.filter((entry) => entry.name.includes(q));
    },
    async stat(adapterId, path) {
      return find(adapterId, path);
    },
    async preview(adapterId, path) {
      const entry = find(adapterId, path);
      if (entry.kind !== "file")
        throw new AppError("VALIDATION_ERROR", "directories have no preview");
      return PREVIEW_CSV_MOCK;
    },
    async download(adapterId, path) {
      find(adapterId, path);
      return { body: "order_id,status\n88213,paid\n", contentType: "text/csv; charset=utf-8" };
    },
    async acceptHostKey(adapterId, fingerprint) {
      requireFiles(adapterId);
      if (fingerprint.length < 8)
        throw new AppError("VALIDATION_ERROR", "fingerprint does not match the server's key");
    },
  };
}
