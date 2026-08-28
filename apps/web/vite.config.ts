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
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist", sourcemap: true },
}));
