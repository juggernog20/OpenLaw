// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

const prefix = "openlaw:setup-draft:v1:";
const fallback = new Map<string, unknown>();

function storageKey(scope: string, field: string) {
  return `${prefix}${scope}:${field}`;
}

export function readSetupDraft<T>(scope: string, field: string, initial: T): T {
  const key = storageKey(scope, field);
  if (fallback.has(key)) return fallback.get(key) as T;
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? initial : (JSON.parse(stored) as T);
  } catch {
    return initial;
  }
}

export function writeSetupDraft<T>(scope: string, field: string, value: T) {
  const key = storageKey(scope, field);
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    fallback.delete(key);
  } catch {
    // If browser storage is unavailable, navigation can still retain the draft.
    fallback.set(key, value);
  }
}

export function clearSetupDrafts(scope?: string) {
  const match = scope === undefined ? prefix : `${prefix}${scope}:`;
  for (const key of fallback.keys()) {
    if (key.startsWith(match)) fallback.delete(key);
  }
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(match)) sessionStorage.removeItem(key);
    }
  } catch {
    // Memory drafts were cleared even when browser storage is blocked.
  }
}

/** Tab-scoped drafts survive route unmounts and reloads until setup clears them. */
export function useSetupDraft<T>(
  scope: string,
  field: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => readSetupDraft(scope, field, initial));
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const next =
        typeof action === "function" ? (action as (previous: T) => T)(current.current) : action;
      current.current = next;
      writeSetupDraft(scope, field, next);
      setValue(next);
    },
    [scope, field],
  );
  return [value, update];
}
