import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The pre-migration copies on a data dir, oldest first (22 §22.2). */
export function preMigrationCopies(dataDir: string): string[] {
  const dir = join(dataDir, "run");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("metadata-") && name.endsWith(".db"))
    .sort();
}
