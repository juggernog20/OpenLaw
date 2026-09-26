// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { pdfjsAssets } from "./vite-pdfjs-assets.ts";
import { documentation } from "./vite-documentation.ts";

const apiOrigin = process.env.DEV_API_ORIGIN ?? "http://localhost:3000";
const appOrigin = process.env.BASE_URL ?? apiOrigin;
const webPort = process.env.WEB_PORT ? Number(process.env.WEB_PORT) : undefined;

export default defineConfig({
  // The doc panel's PDF surface fetches pdf.js's character maps,
  // standard-font metrics, image decoders, and colour profiles by name
  // at run time. They are served from this origin rather than from a
  // CDN (DD-001), which no bundler can arrange on its own.
  plugins: [react(), tailwindcss(), pdfjsAssets(), documentation()],
  // Same-origin in development: the API (and its /api/auth better-auth
  // handler) is proxied so session cookies never cross origins (TECH-008).
  // The Origin header is rewritten because better-auth's CSRF check
  // compares it against its own base URL; production sits same-origin
  // behind the reverse proxy and never needs this.
  //
  // Both ports are read from the environment because `pnpm dev:hot
  // --isolated` runs a second instance on a block of its own, and a
  // proxy still pointing at 3000 would drive the first instance's API
  // from the second instance's screens. Unset means the usual pair.
  build: {
    rolldownOptions: {
      input: { app: "index.html", sw: "src/sw.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  server: {
    headers: { "Service-Worker-Allowed": "/" },
    port: webPort,
    // Vite's fallback is the next free port, which would put the app
    // somewhere the dev loop did not announce and did not reserve.
    strictPort: webPort !== undefined,
    proxy: {
      "/api": {
        target: apiOrigin,
        headers: { origin: appOrigin },
      },
    },
  },
  test: {
    maxWorkers: 4,
    environment: "jsdom",
    setupFiles: ["./src/testing/setup.ts"],
    css: false,
    // The route tests are integration tests: each one mounts the whole
    // application shell through the real route table and drives it with
    // real user gestures, and the ones that type into a debounced
    // typeahead wait out that debounce several times over. Vitest's 5s
    // default is a budget for a unit test, and on a shared CI runner —
    // some six times slower than a developer's machine — the slowest of
    // these sit right on it. The generous bound catches a genuine hang
    // without failing work that is only slow.
    testTimeout: 20_000,
  },
});
