// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { pdfjsAssets } from "./vite-pdfjs-assets.ts";

export default defineConfig({
  // The doc panel's PDF surface fetches pdf.js's character maps,
  // standard-font metrics, image decoders, and colour profiles by name
  // at run time. They are served from this origin rather than from a
  // CDN (DD-001), which no bundler can arrange on its own.
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  // Same-origin in development: the API (and its /api/auth better-auth
  // handler) is proxied so session cookies never cross origins (TECH-008).
  // The Origin header is rewritten because better-auth's CSRF check
  // compares it against its own base URL; production sits same-origin
  // behind the reverse proxy and never needs this.
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        headers: { origin: "http://localhost:3000" },
      },
    },
  },
  test: {
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
