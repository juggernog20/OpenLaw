// SPDX-License-Identifier: AGPL-3.0-only

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// findBy/waitFor default to 1s, which a cold route render can exceed on
// a loaded CI runner — the first test to touch a route pays the whole
// module graph's import cost. Passing queries still resolve immediately.
configure({ asyncUtilTimeout: 5000 });

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

// jsdom ships no ResizeObserver either. Radix measures a control it
// mirrors into a hidden form input — a Checkbox inside a <form> is the
// first case (#231's member picker) — and calls the constructor on
// mount. Nothing here is laid out, so an observer that never fires is
// the honest stand-in.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
