// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-017 per-field commit state machine, as one hook.
 *
 * A record field commits on its own and reports saving, saved, or error
 * beside itself. `StatusNote` draws the note. This module holds the
 * state behind it, so a new per-field surface does not copy the
 * machine (#552).
 *
 * `useFieldCommit` keys the state by field name. `useRowCommit` keys it
 * by row id, for the settings lists that act on one row at a time.
 * Both answer every commit with a `CommitOutcome`, so a caller that has
 * to act on a refusal (a soft gate, a moved precondition) can read its
 * problem type instead of the note.
 */

import { useRef, useState } from "react";
import { problem, type Problem } from "./problem";

/** What a field says beside itself while it commits. */
export type FieldStatus = "idle" | "saving" | "saved" | "error";

/**
 * How a commit ended. A refusal carries the problem envelope's `detail`
 * (the printable sentence) and `type` (the refusal's identity, for the
 * few a client branches on per TECH-020).
 */
export type CommitOutcome = { ok: true } | ({ ok: false } & Problem);

/** What the typed API client resolves with. A 204 has neither `data`
 * nor `error`, so only `error` (or a rejected promise) means failure. */
export interface CommitAnswer<T> {
  data?: T;
  error?: unknown;
  response?: Response;
}

/**
 * One text box that commits on blur or Enter (DES-017).
 *
 * `draft` is what the box holds. `saved` is the record's value for the
 * field. `reset` writes the box. `send` runs the commit for the trimmed
 * text. A `required` field does not commit empty text. It reverts.
 */
export interface TextField {
  draft: string;
  saved: string;
  required?: boolean;
  reset: (value: string) => void;
  send: (value: string) => unknown;
}

/**
 * Per-field commit state keyed by field name.
 *
 * `commit` runs one request for one field, notes saving before it and
 * saved or error after it, and calls `adopt` with the answer so the
 * screen can take the server's row as saved truth (TECH-024 rule 2).
 * `commitText` and `revertText` add the text-box rules on top: the
 * unchanged-value no-op, the empty-required revert, and the guard that
 * stops the blur after Enter from sending the same draft twice.
 */
export function useFieldCommit<K extends string>() {
  const [status, setStatus] = useState<Partial<Record<K, FieldStatus>>>({});
  const [error, setError] = useState<Partial<Record<K, string | undefined>>>({});
  // The fields with a request in flight. A ref, not the state above:
  // Enter and the blur it causes can land before React re-renders, and
  // a guard that read state would let the second send through.
  const inFlight = useRef(new Set<K>());

  function note(key: K, next: FieldStatus, detail?: string) {
    setStatus((current) => ({ ...current, [key]: next }));
    setError((current) => ({ ...current, [key]: detail }));
  }

  async function commit<T>(
    key: K,
    request: () => Promise<CommitAnswer<T>>,
    adopt?: (data: T) => void,
  ): Promise<CommitOutcome> {
    inFlight.current.add(key);
    note(key, "saving");
    let answer: CommitAnswer<T> | undefined;
    try {
      answer = await request();
    } catch {
      answer = undefined;
    } finally {
      inFlight.current.delete(key);
    }
    if (!answer || answer.error !== undefined || answer.response?.ok === false) {
      // A refusal that arrived without its Response still carries a
      // problem body. Only a request that got no answer at all is the
      // network arm.
      const failure = await problem(!answer ? undefined : answer.response ? answer : answer.error);
      note(key, "error", failure.detail);
      return { ok: false, ...failure };
    }
    adopt?.(answer.data as T);
    note(key, "saved");
    return { ok: true };
  }

  function commitText(key: K, field: TextField) {
    // Enter already committed this draft and the request is in flight.
    // The blur that follows must not send a duplicate.
    if (inFlight.current.has(key)) return;
    const draft = field.draft.trim();
    if (draft === field.saved || (field.required && draft === "")) {
      // Nothing to save, or nothing valid. Revert per DES-017.
      field.reset(field.saved);
      return;
    }
    void field.send(draft);
  }

  /** Puts the box back to what the record holds and clears any refusal
   * the abandoned draft left standing. The note was about text that is
   * now gone. Under the saved value it would read as a lie. */
  function revertText(key: K, field: TextField) {
    field.reset(field.saved);
    note(key, "idle");
  }

  return { status, error, note, commit, commitText, revertText };
}

/**
 * Per-row commit state keyed by row id, for the settings lists whose
 * actions (resend, revoke, change role, archive) note beside the row
 * they acted on. The same machine as `useFieldCommit` without the
 * text-box rules, which a row action has no use for.
 */
export function useRowCommit() {
  const { status, error, note, commit } = useFieldCommit<string>();
  return { status, error, note, commit };
}
