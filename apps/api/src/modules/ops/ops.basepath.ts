import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";

import { errorResponse, notFound } from "../../lib/http/index.ts";

export const BASE_PLACEHOLDER = "/__TESTATE_BASE__/";
const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".webmanifest"]);

export type WebAssets = { dir: string; files: number; rewritten: number };

/** The built SPA: /app/web inside the image, apps/web/dist from a source checkout, else none. */
export function resolveWebSource(apiDir: string): string | null {
  const candidates = ["/app/web", join(apiDir, "..", "..", "web", "dist")];
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? null;
}

function rewriteFile(path: string, name: string, base: string): boolean {
  const text = readFileSync(path, "utf8");
  if (!text.includes(BASE_PLACEHOLDER)) return false;
  const replaced = text.replaceAll(BASE_PLACEHOLDER, base);
  const next =
    name === "index.html"
      ? replaced.replace("<head>", `<head>\n    <base href="${base}" />`)
      : replaced;
  writeFileSync(path, next);
  return true;
}

/** Copies the built SPA into run/web and replaces the base placeholder (22 §22.3). Boot-fresh. */
export function rewriteWebAssets(source: string, target: string, basePath: string): WebAssets {
  const base = basePath === "/" ? "/" : `${basePath}/`;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  let files = 0;
  let rewritten = 0;
  for (const entry of readdirSync(target, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue;
    if (rewriteFile(join(entry.parentPath, entry.name), entry.name, base)) rewritten += 1;
  }
  return { dir: target, files, rewritten };
}

/** Static assets under the base, and index.html for every other non-API path (history routing). */
export function mountSpa(app: Hono, basePath: string, apiPrefix: string, webDir: string): void {
  const root = basePath === "/" ? "" : basePath;
  app.get(
    `${root}/assets/*`,
    serveStatic({ root: webDir, rewriteRequestPath: (path) => path.slice(root.length) })
  );
  const index = Bun.file(join(webDir, "index.html"));
  app.get(`${root}/*`, (c) => {
    if (c.req.path.startsWith(apiPrefix)) {
      return errorResponse(c, notFound("route"), c.get("event"), false);
    }
    return new Response(index, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  });
}
