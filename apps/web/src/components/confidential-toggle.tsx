// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Confidential flag as a control (DD-014), in the anatomy the C10
 * frame of `designs/contracts.pen` draws: a switch, the DES-009 lock,
 * the label, and a caption saying what setting it does.
 *
 * Two surfaces ask the same question and must ask it in the same words
 * — the create dialog, where the flag is set before the record exists,
 * and the record's Contract card, where it is set and cleared after.
 * One component is what keeps the second from drifting from the first.
 *
 * Inert is a real state, and on the record it is the common one: every
 * included viewer reads the audience, and only three of them may change
 * it (CTR-022). The label and the caption stay when the switch is
 * inert, so the fact stays legible — a control that vanished would
 * leave the reader unable to tell a confidential record from an open
 * one.
 *
 * The trailing slot is the field's micro-state (DES-017). The create
 * dialog has none: nothing is committed there until the record is.
 */

import { Lock } from "lucide-react";
import { FormattedMessage } from "react-intl";
import type { ReactNode } from "react";
import { Switch } from "./ui/switch";

export function ConfidentialToggle({
  id,
  confidential,
  disabled = false,
  status,
  onChange,
}: Readonly<{
  /** The switch's own id; the label and caption are derived from it, so
   * two toggles on one page never share an accessible name. */
  id: string;
  confidential: boolean;
  /** The record is archived, this viewer reads rather than edits, or
   * they are none of the three actors. All three read the same. */
  disabled?: boolean;
  /** The commit's micro-state, where a surface commits (DES-017). */
  status?: ReactNode;
  onChange: (confidential: boolean) => void;
}>) {
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <Switch
          id={id}
          checked={confidential}
          disabled={disabled}
          aria-describedby={helpId}
          aria-labelledby={labelId}
          onCheckedChange={onChange}
        />
        <Lock size={16} aria-hidden="true" className="shrink-0 text-confidential" />
        <span id={labelId} className="text-sm font-medium text-primary">
          <FormattedMessage
            id="contracts.confidential.field"
            defaultMessage="Confidential — restrict to the contract team"
          />
        </span>
        {status}
      </div>
      {/* Indented past the switch, as the C10 mock aligns it — the
          caption belongs to the label, not to the row. */}
      <p id={helpId} className="ps-12 text-xs text-muted">
        <FormattedMessage
          id="contracts.confidential.hint"
          defaultMessage="Everyone outside the contract team loses the record and everything on it. The Owner and Administrators keep it."
        />
      </p>
    </div>
  );
}
