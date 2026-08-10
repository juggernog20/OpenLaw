// SPDX-License-Identifier: AGPL-3.0-only

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom ships no matchMedia; the shell's md-crossing listener (#46)
// calls it on mount. A query here never matches — component tests are
// layout-free, and tests about the crossing stub their own.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
