// SPDX-License-Identifier: AGPL-3.0-only

/** Browser-only question history for #1098. Route runs record questions;
 * previews do not. Storage events keep open lists in other tabs current. */

import { resolveSearchQuestion, SearchQuestionSchema, type SearchQuestion } from "@openlaw/shared";
import { useMemo, useSyncExternalStore } from "react";

const PREFIX = "openlaw.recent-searches.";
const CHANGED = "openlaw:recent-searches-changed";
const LIMIT = 5;

function identity(question: SearchQuestion): string {
  return JSON.stringify({
    ...question,
    kinds: [...new Set(question.kinds)].sort(),
    conditions: question.conditions
      .map((condition) =>
        JSON.stringify({
          ...condition,
          value:
            Array.isArray(condition.value) && condition.operator !== "between"
              ? [...condition.value].sort()
              : condition.value,
        }),
      )
      .sort(),
  });
}

function snapshot(userId: string): string | null {
  try {
    return localStorage.getItem(`${PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function parse(stored: string | null): SearchQuestion[] {
  try {
    const values: unknown = JSON.parse(stored ?? "[]");
    if (!Array.isArray(values)) return [];
    return values
      .flatMap((value: unknown) => {
        const resolved = resolveSearchQuestion(value);
        return resolved ? [resolved.question] : [];
      })
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function recordRecentSearch(userId: string, question: SearchQuestion) {
  const parsed = SearchQuestionSchema.safeParse(question);
  if (!parsed.success) return;
  const next = parsed.data;
  const key = identity(next);
  const recent = parse(snapshot(userId)).filter((entry) => identity(entry) !== key);
  try {
    localStorage.setItem(`${PREFIX}${userId}`, JSON.stringify([next, ...recent].slice(0, LIMIT)));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Search still runs when the browser refuses local storage.
  }
}

export function clearRecentSearches() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Storage may be disabled by the browser.
  }
}

function subscribe(changed: () => void) {
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}

export function useRecentSearches(userId: string) {
  const stored = useSyncExternalStore(
    subscribe,
    () => snapshot(userId),
    () => null,
  );
  return useMemo(() => parse(stored), [stored]);
}
