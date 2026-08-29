import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@testate/shared";

import { AppError } from "../../lib/http/index.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";

export type SourceFile = { path: string; uploadId: string | null };

type Deps = { files: FilesResolver; dataDir: string };

/** Copies a storage-adapter file under the data dir; the job deletes the folder when it ends (19 §19.3). */
export async function fetchStorageSource(
  deps: Deps,
  project: Project,
  adapterId: string,
  path: string
): Promise<SourceFile> {
  const extension = /\.(csv|tsv|txt|xlsx)$/i.exec(path)?.[1]?.toLowerCase();
  if (extension === undefined)
    throw new AppError("VALIDATION_ERROR", "the source must be a csv, tsv, txt, or xlsx file", {
      reason: "type",
    });
  const { source } = await deps.files.resolve(project.id, adapterId, null);
  try {
    const dir = join(deps.dataDir, "imports", "sources", Bun.randomUUIDv7());
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `source.${extension}`);
    // Bun.write(path, Response(stream)) stalls on a pull stream; a file writer drains it chunk by chunk.
    const writer = Bun.file(target).writer();
    for await (const chunk of await source.read(path)) writer.write(chunk);
    await writer.end();
    return { path: target, uploadId: null };
  } finally {
    await source.close();
  }
}
