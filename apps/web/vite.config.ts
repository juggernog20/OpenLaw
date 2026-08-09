// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  },
});
