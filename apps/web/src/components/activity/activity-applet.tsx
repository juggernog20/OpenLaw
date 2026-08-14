// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The history applet (DD-017, DES-016, DES-026): the record's own
 * account of what happened to it, in the activity bar's third slot,
 * beside the work rather than on a tab you navigate to.
 *
 * It is keyed by an entity reference and names no record type of its
 * own, because one activity log serves every record (DD-017). Contracts
 * mount it in M9; matters (M22) and documents (M11) mount this same
 * component.
 *
 * Each entry is a sentence, not a decoded tuple. The narration is
 * `lib/activity.ts`, which the Administrator's audit log (M9/7) reads
 * too — one answer to "what does this entry say", for both surfaces.
 * A slug this build does not recognise renders plainly there rather
 * than throwing, so a long-lived log never breaks the panel.
 *
 * What the viewer may not hear is not here to be rendered. The API
 * filtered it out at query time (DD-016, DD-017), so there is no
 * placeholder, no gap, and no count of what is missing — and no total
 * in the envelope, for the reason the comment thread has none.
 *
 * **The feed pages.** A contract that has run for two years has a long
 * log behind it, and opening its record must not wait on all of it. The
 * first page arrives when the panel opens; "Show older" walks back one
 * page at a time. No badge: chat is the only applet that carries one
 * (CMT-004).
 *
 * Timestamps follow DES-014's activity-feed rule — relative inside a
 * week, short absolute after — with the long absolute and its timezone
 * in the tooltip, so a cross-region reader knows what they are reading.
 *
 * Inside a confidential record (DD-014), every entry wears DES-009's
 * lock-only micro-marker beside its timestamp, so an entry copied out
 * of the panel carries its restriction with it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import {
  narrateActivity,
  type ActivityEntityType,
  type ActivityEntry,
  type NarrationContext,
} from "../../lib/activity";
import { formatLongDateTime, formatRelativeOrShort } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { Button } from "../ui/button";
import type { Applet } from "../shell/applets";

const HISTORY_LABEL = defineMessage({ id: "activity.applet", defaultMessage: "History" });

/** The medallion's glyph, at DES-008's inline size. The C15 frame draws
 * 12px, which is off the 16/20/24 ramp; 16 is its floor and still sits
 * inside a 24px circle (DES-026). */
const ROW_GLYPH_SIZE = 16;

export interface ActivityAppletOptions {
  /** The record the feed hangs off — its type and its id, never a
   * record-specific address. */
  entityType: ActivityEntityType;
  entityId: string;
  /** What the mount knows that the log does not: the custom fields a
   * `field.<slug>` change key names, and names for the ids the two
   * reference kinds store. */
  fields?: NarrationContext["fields"];
  referenceNames?: NarrationContext["referenceNames"];
  /** Whether the record itself is confidential (DD-014). Every entry
   * then wears DES-009's lock-only micro-marker beside its timestamp,
   * so an entry copied out of the panel carries its restriction. */
  confidential?: boolean;
}

/**
 * The history slot, ready to hand to `RecordApplets`. The feed loads
 * when the panel opens and not before: a closed panel is a tool nobody
 * asked for yet, and the first page of a long log is still a query.
 */
export function useActivityApplet({
  entityType,
  entityId,
  fields,
  referenceNames,
  confidential = false,
}: ActivityAppletOptions): Applet {
  return {
    id: "history",
    icon: History,
    label: HISTORY_LABEL,
    render: () => (
      <ActivityFeed
        entityType={entityType}
        entityId={entityId}
        fields={fields}
        referenceNames={referenceNames}
        confidential={confidential}
      />
    ),
  };
}

function ActivityFeed({
  entityType,
  entityId,
  fields,
  referenceNames,
  confidential = false,
}: Readonly<ActivityAppletOptions>) {
  const intl = useIntl();
  /** null until the first page answers. */
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  /** Where the next page starts, or null at the end of the feed. */
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Guards the pages against each other: a reopen must not have the
   * previous panel's in-flight page land on top of the new one. */
  const generation = useRef(0);

  const loadPage = useCallback(
    async (from: string | null) => {
      const mine = from === null ? (generation.current += 1) : generation.current;
      setBusy(true);
      setLoadFailed(false);
      // A first page drops what the last read answered: a reopen that
      // fails must not leave the previous feed on screen as current.
      if (from === null) {
        setEntries(null);
        setCursor(null);
      }
      const { data } = await api
        .GET("/api/v1/activity", {
          params: { query: { entityType, entityId, ...(from ? { cursor: from } : {}) } },
        })
        .catch(() => ({ data: undefined }));
      if (mine !== generation.current) return;
      setBusy(false);
      if (!data) {
        setLoadFailed(true);
        return;
      }
      setEntries((current) =>
        from === null ? data.entries : [...(current ?? []), ...data.entries],
      );
      setCursor(data.nextCursor);
    },
    [entityType, entityId],
  );

  // The panel mounts when the bar expands it, so this is where "opened"
  // happens. Re-reading on every open keeps a panel left open in one tab
  // from going stale in another.
  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Two failures, and they leave the reader in different places.
            A first page that fails has no feed and no control to retry
            with, so reopening the panel is the way back. A failed "Show
            older" keeps the feed and the button, so the retry is the
            control already on screen. */}
        {loadFailed && entries === null && (
          <p role="alert" className="px-4 py-3 text-sm text-status-danger-fg">
            <FormattedMessage
              id="activity.loadError"
              defaultMessage="The history could not be read. Reopen the panel to try again."
            />
          </p>
        )}
        {entries !== null && entries.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            <FormattedMessage
              id="activity.empty"
              defaultMessage="Nothing has happened to this record yet. Every change to it shows up here."
            />
          </p>
        )}
        {entries !== null && entries.length > 0 && (
          <ol aria-label={intl.formatMessage(HISTORY_LABEL)}>
            {entries.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                fields={fields}
                referenceNames={referenceNames}
                confidential={confidential}
              />
            ))}
          </ol>
        )}
        {/* Beside the control that failed rather than at the top of the
            feed: the reader is at the foot, which is where they pressed. */}
        {loadFailed && entries !== null && (
          <p role="alert" className="px-4 pt-3 text-sm text-status-danger-fg">
            <FormattedMessage
              id="activity.olderError"
              defaultMessage="The older entries could not be read. Try again."
            />
          </p>
        )}
        {cursor !== null && (
          <div className="px-4 py-3">
            <Button variant="secondary" disabled={busy} onClick={() => void loadPage(cursor)}>
              <FormattedMessage id="activity.older" defaultMessage="Show older" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One entry (DES-026): a 24px medallion carrying the action family's
 * glyph, then the sentence, then the timestamp.
 *
 * A change reads as its own line under the sentence. One change is
 * already named by the sentence, so its line is the pair alone; several
 * need their labels to be told apart.
 */
function ActivityRow({
  entry,
  fields,
  referenceNames,
  confidential,
}: Readonly<{
  entry: ActivityEntry;
  fields?: NarrationContext["fields"];
  referenceNames?: NarrationContext["referenceNames"];
  /** The record is confidential, so the entry wears DES-009's micro
   * marker beside its timestamp. */
  confidential: boolean;
}>) {
  const intl = useIntl();
  const {
    icon: Icon,
    sentence,
    changes,
  } = narrateActivity(intl, entry, { fields, referenceNames });
  return (
    <li className="flex gap-2.5 border-b border-border-muted px-4 py-2.5 last:border-b-0">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-control text-muted"
      >
        <Icon size={ROW_GLYPH_SIZE} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-primary">{sentence}</p>
        {/* Keyed by position: the list is one entry's own payload, read
            once and never reordered, and two changed keys can resolve to
            the same label when a field has been detached and only its
            slug is left. */}
        {changes.map((change, index) => (
          <p key={index} className="text-xs break-words text-muted">
            {/* One change is already named by the sentence above, so its
                line is the pair alone. Several need their labels to be
                told apart. */}
            {changes.length > 1 ? (
              <FormattedMessage
                id="activity.changeWithLabel"
                defaultMessage="{label}: {from} → {to}"
                values={{ label: change.label, from: change.from, to: change.to }}
              />
            ) : (
              <FormattedMessage
                id="activity.change"
                defaultMessage="{from} → {to}"
                values={{ from: change.from, to: change.to }}
              />
            )}
          </p>
        ))}
        {/* DES-009 Tier 1's micro variant, beside the timestamp where
            the decision puts it. Decorative: the record's banner is a
            labelled landmark already saying this, and repeating it on
            every entry would be noise rather than information. */}
        <span className="flex items-center gap-1">
          {confidential && <ConfidentialMarker variant="micro" />}
          <time
            dateTime={entry.createdAt}
            title={formatLongDateTime(entry.createdAt, { locale: intl.locale })}
            className="text-xs text-muted"
          >
            {formatRelativeOrShort(entry.createdAt, { locale: intl.locale })}
          </time>
        </span>
      </div>
    </li>
  );
}
