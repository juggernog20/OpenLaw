// SPDX-License-Identifier: AGPL-3.0-only

/**
 * E2E configuration (TECH-018): the suite runs against the blessed Compose
 * stack's origin — built images, real Postgres, real HTTP — never a dev
 * server. Point E2E_BASE_URL elsewhere to target a fresh throwaway stack;
 * the default is the persistent local instance.
 *
 * Serial on purpose: one worker, no parallelism. The suites are journeys
 * through one shared, persistent instance, and later flows build on state
 * earlier ones created.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
