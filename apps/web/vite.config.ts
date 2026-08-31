import { Agent } from "node:http";
import { fileURLToPath } from "node:url";
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
  server: {
    port: 7379,
    // No keep-alive: Bun closes idle sockets and the proxy would answer the next request with a 502.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7378",
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
