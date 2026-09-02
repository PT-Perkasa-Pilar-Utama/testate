import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { EmbeddedFile } from "../../embedded.ts";

export type Unpacked = {
  /** The SPA's directory, or null when nothing is embedded. */
  web: string | null;
  /** The migrations directory, or null when nothing is embedded. */
  migrations: string | null;
  files: number;
};

/**
 * Writes a binary's embedded files under the data directory so the rest of boot can read them
 * the way it reads the image's: `serveStatic` and the migration runner want a directory, not a
 * list of blobs. Every boot rewrites them, which costs a few hundred small writes and means an
 * upgraded binary never serves the previous version's assets from a stale unpack (22 §22.3).
 */
export async function unpackEmbedded(
  dataDir: string,
  version: string,
  embedded: readonly EmbeddedFile[]
): Promise<Unpacked> {
  if (embedded.length === 0) return { web: null, migrations: null, files: 0 };
  const root = join(dataDir, "run", "app", version);
  for (const entry of embedded) {
    const target = join(root, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, Bun.file(entry.file));
  }
  const has = (prefix: string): boolean => embedded.some((entry) => entry.path.startsWith(prefix));
  return {
    web: has("web/") ? join(root, "web") : null,
    migrations: has("migrations/") ? join(root, "migrations") : null,
    files: embedded.length,
  };
}
