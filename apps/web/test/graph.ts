import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../src");
const SPECIFIER = /from\s+"([^"]+)"/g;
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** `@/x` and `./x` name files in this app; anything else is a package and stops the walk. */
function isLocal(specifier: string): boolean {
  return specifier.startsWith("@/") || specifier.startsWith(".");
}

function resolveLocal(specifier: string, from: string): string {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : resolve(dirname(from), specifier);
  for (const suffix of CANDIDATES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${from} imports ${specifier}, which resolves to no file`);
}

/** Every file the entries reach through local imports, the entries included. */
export function reachable(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((entry) => resolve(entry));
  while (queue.length > 0) {
    const file = queue.pop() ?? "";
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const specifier = match[1] ?? "";
      if (isLocal(specifier)) queue.push(resolveLocal(specifier, file));
    }
  }
  return [...seen];
}
