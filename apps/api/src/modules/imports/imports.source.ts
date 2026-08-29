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
  if (!/\.csv$/i.test(path))
    throw new AppError("ENGINE_UNSUPPORTED", "only CSV sources are supported in this build", {
      reason: "type",
    });
  const { source } = await deps.files.resolve(project.id, adapterId, null);
  try {
    const dir = join(deps.dataDir, "imports", "sources", Bun.randomUUIDv7());
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "source.csv");
    await Bun.write(target, new Response(await source.read(path)));
    return { path: target, uploadId: null };
  } finally {
    await source.close();
  }
}
