import type { Entry } from "@testate/shared";

export type BatchMode = "move" | "copy";

/** `exports/2026` + `report.csv` → `exports/2026/report.csv`; the root has no prefix. */
export function destinationOf(folder: string, name: string): string {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  return clean === "" ? name : `${clean}/${name}`;
}

/**
 * Moves or copies every ticked entry into a folder, one call each and one at a time: these go
 * over SFTP and FTP, where a session runs a single command. A folder cannot be copied, and a
 * store refuses to move one, so folders are left where they are and named in the answer.
 */
export async function moveOrCopy(
  mode: BatchMode,
  rows: readonly Entry[],
  folder: string,
  calls: {
    rename: (path: string, to: string) => Promise<Entry>;
    copy: (path: string, to: string) => Promise<Entry>;
  }
): Promise<{ done: number; failed: string[] }> {
  const failed: string[] = [];
  let done = 0;
  for (const entry of rows) {
    const to = destinationOf(folder, entry.name);
    if (entry.kind === "directory") {
      failed.push(entry.name);
      continue;
    }
    try {
      await (mode === "move" ? calls.rename(entry.path, to) : calls.copy(entry.path, to));
      done += 1;
    } catch {
      failed.push(entry.name);
    }
  }
  return { done, failed };
}
