// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-017 per-field micro-states: every settings field commits
 * individually and reports saving/saved/error beside itself, announced
 * politely to readers. Shared by the panes that commit per field.
 */

import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { cn } from "../lib/utils";

// The status lives with the state machine that produces it
// (lib/field-commit.ts, #552). Re-exported here so the panes that only
// draw the note keep one import.
import type { FieldStatus } from "../lib/field-commit";

export type { FieldStatus };

// Mounted for each successful save, so the next saving state cancels
// these timers without changing the field's commit state.
function SavedNote() {
  const [phase, setPhase] = useState<"visible" | "fading" | "hidden">("visible");

  useEffect(() => {
    const fade = window.setTimeout(() => setPhase("fading"), 3_000);
    const hide = window.setTimeout(() => setPhase("hidden"), 3_300);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(hide);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <span
      className={cn(
        "transition-opacity duration-300 motion-reduce:transition-none",
        phase === "fading" ? "opacity-0" : "opacity-100",
      )}
    >
      <FormattedMessage id="settings.field.saved" defaultMessage="Saved" />
    </span>
  );
}

export function StatusNote({
  status,
  detail,
}: Readonly<{
  status: FieldStatus;
  /** Server-provided user-visible copy (a problem envelope's `detail`);
   * rendered as-is, so it deliberately bypasses react-intl. */
  detail?: string | null;
}>) {
  return (
    <span
      aria-live="polite"
      className={cn("text-xs", status === "error" ? "text-status-danger-fg" : "text-muted")}
    >
      {status === "saving" && (
        <FormattedMessage id="settings.field.saving" defaultMessage="Saving…" />
      )}
      {status === "saved" && <SavedNote />}
      {/* The API's own refusal (already localized policy language like the
          last-Administrator floor) beats the generic line when it exists —
          an empty string counts as absent, never as a blank note. */}
      {status === "error" &&
        (detail || (
          <FormattedMessage
            id="settings.field.error"
            defaultMessage="The change could not be saved. Try again."
          />
        ))}
    </span>
  );
}
