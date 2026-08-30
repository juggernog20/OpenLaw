// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Confidential flag as a control (DD-014), in the anatomy the C10
 * frame of `designs/contracts.pen` draws: a switch, the DES-009 lock,
 * and the label. The label says what the flag does ("restrict to the
 * contract team"), so the caption the mock draws under it is omitted.
 * It only restated the row it hangs off.
 *
 * Two surfaces ask the same question and must ask it in the same words:
 * the create dialog, where the flag is set before the record exists,
 * and the record's Contract card, where it is set and cleared after.
 * One component keeps the second from drifting from the first.
 *
 * Inert is a real state, and on the record it is the common one: every
 * included viewer reads the audience, and only three actors may change
 * it (CTR-022). The switch and its label stay when the control is
 * inert, so the fact stays legible. A control that vanished would
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
  record = "contract",
  onChange,
}: Readonly<{
  /** The switch's own id; the label's id is derived from it, so two
   * toggles on one page never share an accessible name. */
  id: string;
  confidential: boolean;
  /** Inert when the record is archived, the viewer reads rather than
   * edits, or the viewer is none of the three CTR-022 actors. All three
   * cases render the same. */
  disabled?: boolean;
  /** The commit's micro-state, where a surface commits (DES-017). */
  status?: ReactNode;
  record?: "contract" | "matter" | "entity";
  onChange: (confidential: boolean) => void;
}>) {
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <Switch
          id={id}
          checked={confidential}
          disabled={disabled}
          aria-labelledby={labelId}
          onCheckedChange={onChange}
        />
        <Lock size={16} aria-hidden="true" className="shrink-0 text-confidential" />
        <span id={labelId} className="text-sm font-medium text-primary">
          {record === "matter" ? (
            <FormattedMessage
              id="matters.confidential.field"
              defaultMessage="Confidential — restrict to the matter team"
            />
          ) : record === "entity" ? (
            <FormattedMessage
              id="entities.confidential.field"
              defaultMessage="Confidential — restrict to the grant list"
            />
          ) : (
            <FormattedMessage
              id="contracts.confidential.field"
              defaultMessage="Confidential — restrict to the contract team"
            />
          )}
        </span>
        {status}
      </div>
    </div>
  );
}
