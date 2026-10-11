import { fileURLToPath } from "node:url";
import webPackage from "./package.json" with { type: "json" };
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

/**
 * The browser-only demo (#demo): the SPA from `src/`, unchanged, and the API from `apps/api/src`
 * running in the same page. Every Bun, Node and driver import the API makes resolves to a shim in
 * `demo/shims`; none of these aliases reach `vite.config.ts` or the production build.
 */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const shim = (name: string): string => here(`./demo/shims/${name}`);

/**
 * Tailwind scans from Vite's root, which is `demo/` here, so the SPA's classes went unseen. The
 * stylesheet's import gains a source pointing at `src/`, for this build only.
 */
const scanTheSpa: Plugin = {
  name: "demo:tailwind-source",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/src/styles/app.css")) return null;
    return code.replace('@import "tailwindcss";', '@import "tailwindcss" source("..");');
  },
};

export default defineConfig({
  root: here("./demo"),
  publicDir: here("./public"),
  base: "/testate/demo/",
  plugins: [scanTheSpa, solidPlugin(), tailwindcss()],
  resolve: {
    // `hono` is pinned in apps/api and, for the demo's root, apps/web: keep the two at one version
    // so the routers and the app share one copy.
    dedupe: ["hono"],
    alias: [
      { find: "@demo/backend", replacement: here("./demo/backend/entry.ts") },
      { find: "@", replacement: here("./src") },
      { find: /^bun:sqlite$/, replacement: shim("sqlite.ts") },
      { find: /^bun$/, replacement: shim("drivers.ts") },
      { find: /^node:fs$/, replacement: shim("fs.ts") },
      { find: /^node:fs\/promises$/, replacement: shim("fs-promises.ts") },
      { find: /^node:path$/, replacement: shim("path.ts") },
      { find: /^node:(net|dns\/promises|os|http|tls)$/, replacement: shim("net.ts") },
      { find: /^node:(stream|zlib)$/, replacement: shim("stream.ts") },
      { find: /^node:crypto$/, replacement: shim("crypto.ts") },
      { find: /^(mongodb|ssh2|ssh2-sftp-client|basic-ftp)$/, replacement: shim("drivers.ts") },
      { find: /^hono\/cookie$/, replacement: shim("cookie.ts") },
      { find: /^hono\/bun$/, replacement: shim("hono-bun.ts") },
    ],
  },
  optimizeDeps: { exclude: ["@formisch/solid", "@formisch/core"] },
  define: {
    "import.meta.env.VITE_TESTATE_VERSION": JSON.stringify(webPackage.version),
    // `lib/db` computes a default migrations folder at load; the demo passes its own.
    "import.meta.dir": JSON.stringify("/api"),
  },
  build: {
    outDir: here("../../docs/demo"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
});
