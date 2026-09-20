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

// And no scrollIntoView, because jsdom lays nothing out. A combobox
// keeping its active row in view calls it on every arrow press (the
// link picker is the first), so a no-op stands in for the scroll a
// layout-free tree could not perform anyway.
Element.prototype.scrollIntoView ??= () => {};

// jsdom 30.1 keeps the Document as the focused area once a focused element
// is removed, and the next focus() call then fires blur and focusout at the
// Window with the newly focused element as relatedTarget (jsdom/jsdom#4347).
// A browser never does that: the Document sits in both the old and the new
// focus chain, so a focus move inside the page is invisible to the Window.
// Radix Menu and Select close on a Window blur, because that means the user
// left the page, so every dropdown opened after cleanup() had unmounted a
// focused control closed itself on the spot. Swallow the synthetic pair
// before Radix sees it. A genuine Window blur carries no relatedTarget and
// still goes through. Vitest hands tests Node's global as `window`, so the
// Window is recognised as the one focus target that is not a DOM node.
for (const type of ["blur", "focusout"] as const) {
  window.addEventListener(
    type,
    (event) => {
      if (!(event.target instanceof Node) && (event as FocusEvent).relatedTarget !== null) {
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}

// jsdom has no EventSource. Most route suites only need the authenticated
// shell to own a quiet connection; live-surface suites replace this with
// the controllable double from testing/helpers.
class QuietEventSource extends EventTarget implements EventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials: boolean;
  readonly readyState = 0;
  onopen: EventSource["onopen"] = null;
  onmessage: EventSource["onmessage"] = null;
  onerror: EventSource["onerror"] = null;
  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
  }
  addEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, event: EventSourceEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(type: string, listener: unknown, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
  }
  removeEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, event: EventSourceEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(type: string, listener: unknown, options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, listener as EventListenerOrEventListenerObject, options);
  }
  close() {}
}
globalThis.EventSource ??= QuietEventSource;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
