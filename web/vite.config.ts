import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The frontend build.
 *
 * `root` and `outDir` are absolute because npm scripts run from the repo root,
 * and Vite resolves a relative `root` against the working directory rather than
 * against this file. The build lands in `web/dist`, which is what
 * `web/wrangler.jsonc` serves as its static assets -- so `wrangler dev` on
 * 127.0.0.1:8788 serves exactly what production will.
 *
 * The dev proxy exists only for `npm run dev:ui` (Vite's own server with hot
 * reload). It forwards /api to the Worker, which must be running separately.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./app", import.meta.url)),
  base: "/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
});
