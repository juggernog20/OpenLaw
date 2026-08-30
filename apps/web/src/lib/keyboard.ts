// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Global keyboard contract (DES-010, #45). KEY_MAP is the single
 * source of truth: the cheat-sheet renders from it and useGlobalKeys
 * registers handlers from it, so the displayed shortcuts cannot drift
 * from real behavior. Entries without an action document behavior
 * owned elsewhere. Radix closes overlays on Esc and restores focus
 * to the trigger; the browser owns Tab, Enter, and Space.
 */

import { useEffect, useRef } from "react";
import { defineMessage, type MessageDescriptor } from "react-intl";

/** The key that focuses search. The search input's keycap chip shows
 * it too, so the affordance can't drift from the binding. */
export const SEARCH_KEY = "/";

/** Actions useGlobalKeys runs itself. */
type KeyAction = "focus-search" | "open-cheat-sheet";

/** KEY_MAP descriptors always carry a defaultMessage string. The
 * cheat-sheet and its drift-guard test read it without narrowing. */
type KeyMessage = MessageDescriptor & { defaultMessage: string };

export interface KeyBinding {
  /** Keycaps the cheat-sheet displays. */
  keys: readonly string[];
  description: KeyMessage;
  /** Present only on entries this app handles with a global listener:
   * the KeyboardEvent key to match and the action to run. */
  action?: { key: string; run: KeyAction };
}

export interface KeySection {
  title: KeyMessage;
  bindings: readonly KeyBinding[];
}

export const KEY_MAP: readonly KeySection[] = [
  {
    title: defineMessage({ id: "keys.section.global", defaultMessage: "Global" }),
    bindings: [
      {
        keys: [SEARCH_KEY],
        description: defineMessage({ id: "keys.focusSearch", defaultMessage: "Focus search" }),
        action: { key: SEARCH_KEY, run: "focus-search" },
      },
      {
        keys: ["?"],
        description: defineMessage({
          id: "keys.openCheatSheet",
          defaultMessage: "Open keyboard shortcuts",
        }),
        action: { key: "?", run: "open-cheat-sheet" },
      },
      {
        keys: ["Esc"],
        description: defineMessage({
          id: "keys.closeOverlay",
          defaultMessage: "Close the open menu or dialog",
        }),
      },
    ],
  },
  {
    title: defineMessage({
      id: "keys.section.components",
      defaultMessage: "In menus and dialogs",
    }),
    bindings: [
      {
        keys: ["Tab"],
        description: defineMessage({
          id: "keys.tab",
          defaultMessage: "Move to the next control",
        }),
      },
      {
        keys: ["↑", "↓"],
        description: defineMessage({
          id: "keys.arrows",
          defaultMessage: "Move within menus and lists",
        }),
      },
      {
        keys: ["Enter"],
        description: defineMessage({
          id: "keys.enter",
          defaultMessage: "Activate the focused control",
        }),
      },
      {
        keys: ["Space"],
        description: defineMessage({
          id: "keys.space",
          defaultMessage: "Toggle the focused control",
        }),
      },
    ],
  },
];

/**
 * The `/` dispatch from DES-010: search inputs register here, and the
 * global handler focuses the most recently mounted one. A page-level
 * input layered over the shell header wins while it is mounted.
 */
const searchTargets: HTMLElement[] = [];

/** Registers a search input as the `/` focus target. Returns the
 * unregister cleanup. Hand it straight back from a React 19 ref
 * callback. */
export function registerSearchTarget(element: HTMLElement): () => void {
  searchTargets.push(element);
  return () => {
    const index = searchTargets.indexOf(element);
    if (index !== -1) searchTargets.splice(index, 1);
  };
}

/** Where typed keys must stay literal (editable fields) or stay local
 * to an open overlay Radix is already driving. */
const SUPPRESSED_WITHIN =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]';

/**
 * Mounts the global key listener, wiring the KEY_MAP entries that
 * declare an action. Registered once; the cheat-sheet opener is read
 * through a ref so callers can pass a fresh closure every render.
 */
export function useGlobalKeys(options: { onOpenCheatSheet: () => void }): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const bound = KEY_MAP.flatMap((section) => section.bindings).filter(
      (binding) => binding.action !== undefined,
    );

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      // Shift stays allowed. Typing ? needs it.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const binding = bound.find((candidate) => candidate.action?.key === event.key);
      if (!binding?.action) return;
      if (event.target instanceof Element && event.target.closest(SUPPRESSED_WITHIN)) return;
      event.preventDefault();
      switch (binding.action.run) {
        case "focus-search":
          searchTargets.at(-1)?.focus();
          break;
        case "open-cheat-sheet":
          optionsRef.current.onOpenCheatSheet();
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
