// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record's overflow menu (DES-055): the acts that belong
 * to the record as a whole, behind one trigger at the end of the
 * sub-bar.
 *
 * It is deliberately short. An act that belongs to one field commits
 * from that field (DES-017), an act that belongs to one section commits
 * from that section's card, and neither is repeated here — a second
 * control for one datum is what DES-053 refused for the status. What
 * is left is the record: copy a link to it, rename it, archive it.
 *
 * The trigger is a fixed-width icon button, so the group it closes
 * keeps one width and the stage strip beside it stays where DES-034
 * clause 9 pins it.
 */

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Check, Link2, MoreHorizontal, Pencil } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/** How long the copy row says "Copied" before it offers the act again.
 * The same 2s the e-signature pane's copy button already spends. */
const COPIED_MS = 2000;

export function RecordActionsMenu({
  number,
  archived,
  busy,
  onRename,
  onArchive,
}: Readonly<{
  /** The contract number, which is the link this copies. */
  number: number;
  archived: boolean;
  /** An archive or restore is out; the trigger is inert until it lands. */
  busy: boolean;
  /** Absent for a reader who may not write: the row is not drawn. */
  onRename?: () => void;
  onArchive?: () => void;
}>) {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when Rename is picked, read once the menu has finished closing. */
  const renameWanted = useRef(false);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  /** The record's own address, not the reader's current one: a link
   * copied from the Documents section should still open the record. */
  async function copyLink(): Promise<void> {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    try {
      await navigator.clipboard.writeText(
        new URL(`/contracts/${number}`, window.location.origin).toString(),
      );
      setCopied(true);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // A browser that refuses the clipboard leaves the address bar as
      // the way to copy a link — there is nothing to report.
      setCopied(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={intl.formatMessage({
            id: "contracts.record.actions",
            defaultMessage: "Contract actions",
          })}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!renameWanted.current) return;
          renameWanted.current = false;
          // Radix pulls the focus back to the trigger as it closes, and
          // it does that after `onSelect` has run. Renaming ends in the
          // title field, so the menu gives up its own restore and lets
          // `onRename` place the focus once the menu is gone.
          event.preventDefault();
          onRename?.();
        }}
      >
        {/* Copying is the one row every reader gets, including one who
            may not write: a link to a record is not a change to it. */}
        <DropdownMenuItem
          onSelect={(event) => {
            // The menu stays open so the row itself can say it worked.
            // Closing it would take the only confirmation with it.
            event.preventDefault();
            void copyLink();
          }}
        >
          {copied ? (
            <>
              <Check size={16} aria-hidden="true" className="text-status-success-fg" />
              <FormattedMessage id="action.copied" defaultMessage="Copied" />
            </>
          ) : (
            <>
              <Link2 size={16} aria-hidden="true" />
              <FormattedMessage id="contracts.record.copyLink" defaultMessage="Copy link" />
            </>
          )}
        </DropdownMenuItem>
        {/* Renaming is not a second editor. It takes the reader to the
            title field on the Contract card and focuses it, so the
            record keeps one place where its title is written
            (DES-017). An archived record has no editable title, so the
            row is absent rather than disabled. */}
        {onRename && (
          <DropdownMenuItem onSelect={() => (renameWanted.current = true)}>
            <Pencil size={16} aria-hidden="true" />
            <FormattedMessage id="contracts.record.rename" defaultMessage="Rename contract" />
          </DropdownMenuItem>
        )}
        {onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onArchive}>
              {archived ? (
                <>
                  <ArchiveRestore size={16} aria-hidden="true" />
                  <FormattedMessage id="contracts.record.restore" defaultMessage="Restore" />
                </>
              ) : (
                <>
                  <Archive size={16} aria-hidden="true" />
                  <FormattedMessage id="contracts.record.archive" defaultMessage="Archive" />
                </>
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
