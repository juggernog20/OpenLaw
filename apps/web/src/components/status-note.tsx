// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-017 per-field micro-states: every settings field commits
 * individually and reports saving/saved/error beside itself, announced
 * politely to readers. Shared by the panes that commit per field.
 */

import { FormattedMessage } from "react-intl";
import { cn } from "../lib/utils";

export type FieldStatus = "idle" | "saving" | "saved" | "error";

export function StatusNote({ status }: { status: FieldStatus }) {
  return (
    <span
      aria-live="polite"
      className={cn("text-xs", status === "error" ? "text-status-danger-fg" : "text-muted")}
    >
      {status === "saving" && (
        <FormattedMessage id="settings.field.saving" defaultMessage="Saving…" />
      )}
      {status === "saved" && <FormattedMessage id="settings.field.saved" defaultMessage="Saved" />}
      {status === "error" && (
        <FormattedMessage
          id="settings.field.error"
          defaultMessage="The change could not be saved. Try again."
        />
      )}
    </span>
  );
}
