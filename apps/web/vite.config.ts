import { Agent } from "node:http";
import { fileURLToPath } from "node:url";
import { version } from "./package.json" with { type: "json" };
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The production build bakes a placeholder base path that the API rewrites at
// boot to TESTATE_BASE_PATH (docs/technical-specs/22-base-path-and-boot.md).
// The dev server serves from "/" and proxies the API.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/__TESTATE_BASE__/" : "/",
  plugins: [solidPlugin(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Formisch ships two builds. Its `solid` export condition serves raw JSX that imports only from
  // `solid-js`; the default one is pre-compiled against `solid-js/web`, a package that does not
  // exist under Solid 2. Excluding it from pre-bundling keeps esbuild from resolving the wrong one
  // and leaves the JSX for the Solid plugin to compile (patches/README.md says why it is patched).
  optimizeDeps: { exclude: ["@formisch/solid", "@formisch/core"] },
  // The version a bug report quotes. `bun run bump-version` already keeps this package.json in
  // step with the others, so there is no second place to forget.
  define: { "import.meta.env.VITE_TESTATE_VERSION": JSON.stringify(version) },
  server: {
    // The e2e suite runs its own pair on 7479/7478 so it never fights `bun run dev`, and
    // `strictPort` makes a clash say so instead of quietly moving to the next free port.
    port: Number(process.env["WEB_PORT"] ?? 7379),
    strictPort: true,
    // No keep-alive: Bun closes idle sockets and the proxy would answer the next request with a 502.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env["API_PORT"] ?? 7378}`,
        agent: new Agent({ keepAlive: false }),
        configure: (proxy) => {
          proxy.on("error", (error, req) => {
            process.stderr.write(
              `[proxy] ${req.method ?? ""} ${req.url ?? ""}: ${error.message}\n`
            );
          });
        },
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
}));
