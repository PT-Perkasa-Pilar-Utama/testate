/**
 * The API's migrations, inlined at build time and laid on the demo's disk, so the real
 * `migrate()` reads them as it reads a directory.
 */
import { put } from "../shims/memfs.ts";

export const MIGRATIONS_DIR = "/migrations";

const texts: Record<string, string> = import.meta.glob("../../../api/src/db/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const encoder = new TextEncoder();
for (const [path, text] of Object.entries(texts)) {
  put(`${MIGRATIONS_DIR}/${path.slice(path.lastIndexOf("/") + 1)}`, encoder.encode(text));
}
