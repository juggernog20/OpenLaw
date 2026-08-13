// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The comment applet (CMT-004, DES-016): the conversation about a
 * record, in the activity bar's chat slot, beside the work rather than
 * on a tab you navigate to.
 *
 * It is keyed by an entity reference and names no record type of its
 * own, because the thread is one machinery (CMT-001). Contracts mount it
 * in M9; matters (M22) and documents (M11) mount this same component.
 *
 * The thread is flat and chronological (CMT-002). Every row carries its
 * DD-016 tier badge, and a Legal Only row is tinted and locked so the
 * tier reads peripherally rather than by squinting at the badge
 * (CMT-003). What the viewer may not hear is not here to be rendered —
 * the API filtered it out at query time, so there is no placeholder, no
 * gap, and no count of what is missing. The header's count pill counts
 * the rows on screen, which is the only number that cannot leak.
 *
 * The Legal Only row takes its own wash (DES-023's `--legal-only-bg`),
 * a step lighter than DES-009's confidentiality banner, so the badge on
 * top of it can keep the banner's own pair and still stand out.
 *
 * The composer is a three-segment tier control, preset to Working Team
 * on a record page (DD-016), and the audience each segment means is
 * named under it — before posting, never after. A Contributor's
 * composer has no Legal Only segment at all; the seam refuses the tier
 * regardless, so the absence is a courtesy and not the enforcement.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { Lock, MessageSquare } from "lucide-react";
import { api } from "../../lib/api";
import {
  composerTiers,
  RECORD_DEFAULT_TIER,
  tierAudience,
  tierLabel,
  type Comment,
  type CommentEntityType,
  type CommentTier,
} from "../../lib/comments";
import { formatLongDateTime, formatRelativeOrShort } from "../../lib/format";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { problemDetail } from "../../lib/messages";
import type { Role } from "../../lib/roles";
import { cn } from "../../lib/utils";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import type { Applet } from "../shell/applets";

const CHAT_LABEL = defineMessage({ id: "comments.applet", defaultMessage: "Comments" });

/** The lock is DES-009's glyph at DES-009's own inline size (12–14px),
 * not DES-008's 16/20/24 ramp: it rides inside an 11px badge, where a
 * 16px glyph would be taller than the text it marks. */
const LOCK_SIZE = 12;

export interface CommentAppletOptions {
  /** The record the thread hangs off — its type and its id, never a
   * record-specific address. */
  entityType: CommentEntityType;
  entityId: string;
  /** The viewer's DD-013 role, which decides the composer's segments. */
  role: Role;
}

/**
 * The chat slot, ready to hand to `RecordApplets`. The thread loads when
 * the panel opens and not before: a closed panel is a tool nobody asked
 * for yet, and M9/4's unread badge is what will read the record without
 * one.
 */
export function useCommentApplet({ entityType, entityId, role }: CommentAppletOptions): Applet {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    // Drop what the last read answered before asking again. A reopen
    // that fails must not leave the previous thread — or its count — on
    // screen as though it were current.
    setComments(null);
    const { data } = await api
      .GET("/api/v1/comments", { params: { query: { entityType, entityId } } })
      .catch(() => ({ data: undefined }));
    if (!data) {
      setLoadFailed(true);
      return;
    }
    setComments(data.comments);
  }, [entityType, entityId]);

  return {
    id: "chat",
    icon: MessageSquare,
    label: CHAT_LABEL,
    accessory: () => (comments === null ? null : <CountPill count={comments.length} />),
    render: () => (
      <CommentThread
        entityType={entityType}
        entityId={entityId}
        role={role}
        comments={comments}
        loadFailed={loadFailed}
        onLoad={load}
        onPosted={(posted) => setComments((current) => [...(current ?? []), posted])}
      />
    ),
  };
}

/** The M3 header pill: how many comments are on screen. It counts the
 * filtered set, because the filtered set is all there is. */
function CountPill({ count }: Readonly<{ count: number }>) {
  const intl = useIntl();
  return (
    <span className="rounded-pill bg-badge-count-bg px-2 py-px text-xs font-semibold text-badge-count-fg">
      {intl.formatNumber(count)}
    </span>
  );
}

function CommentThread({
  entityType,
  entityId,
  role,
  comments,
  loadFailed,
  onLoad,
  onPosted,
}: Readonly<{
  entityType: CommentEntityType;
  entityId: string;
  role: Role;
  /** null until the first read answers. */
  comments: readonly Comment[] | null;
  loadFailed: boolean;
  onLoad: () => Promise<void>;
  onPosted: (comment: Comment) => void;
}>) {
  const intl = useIntl();

  // The panel mounts when the bar expands it, so this is where "opened"
  // happens. Re-reading on every open keeps a thread left open in one
  // tab from going stale in another.
  useEffect(() => {
    void onLoad();
  }, [onLoad]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadFailed && (
          <p role="alert" className="px-4 py-3 text-sm text-status-danger-fg">
            <FormattedMessage
              id="comments.loadError"
              defaultMessage="The conversation could not be read. Reopen the panel to try again."
            />
          </p>
        )}
        {comments !== null && comments.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            <FormattedMessage
              id="comments.empty"
              defaultMessage="Nothing has been said about this record yet. Add the first comment to keep the conversation on the record."
            />
          </p>
        )}
        {comments !== null && comments.length > 0 && (
          <ol aria-label={intl.formatMessage(CHAT_LABEL)}>
            {comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </ol>
        )}
      </div>
      <Composer entityType={entityType} entityId={entityId} role={role} onPosted={onPosted} />
    </div>
  );
}

/**
 * One comment. A Legal Only row takes the confidential tint and the lock
 * glyph, so the room it was said in reads before the badge does
 * (CMT-003). The badge is always a step of surface away from its row,
 * which is what keeps it legible on the tint and off it.
 */
function CommentRow({ comment }: Readonly<{ comment: Comment }>) {
  const intl = useIntl();
  const legalOnly = comment.visibility === "legal_only";
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 border-b border-border-muted px-4 py-3 last:border-b-0",
        legalOnly && "bg-legal-only-bg",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={comment.author.displayName} image={comment.author.image} className="size-6" />
        <span
          className={cn("truncate text-sm font-semibold", comment.author.archived && "opacity-50")}
        >
          {comment.author.displayName}
        </span>
        <TierBadge tier={comment.visibility} />
        <time
          dateTime={comment.createdAt}
          title={formatLongDateTime(comment.createdAt, { locale: intl.locale })}
          className="ms-auto shrink-0 text-xs text-muted"
        >
          {formatRelativeOrShort(comment.createdAt, { locale: intl.locale })}
        </time>
      </div>
      {/* User-generated text: newlines are the author's, so they are
          kept rather than collapsed (DES-015). */}
      <p className="text-sm whitespace-pre-wrap text-primary">{comment.body}</p>
    </li>
  );
}

/** The tier every comment wears (CMT-003). Legal Only takes DES-009's
 * own pair and its lock glyph, one step deeper than the row it sits on;
 * the other two are neutral counters on the panel's own surface. */
function TierBadge({ tier }: Readonly<{ tier: CommentTier }>) {
  const intl = useIntl();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-px text-xs font-semibold",
        tier === "legal_only"
          ? "bg-confidential-bg text-confidential"
          : "bg-badge-count-bg text-badge-count-fg",
      )}
    >
      {tier === "legal_only" && <Lock size={LOCK_SIZE} aria-hidden="true" />}
      {tierLabel(intl, tier)}
    </span>
  );
}

/**
 * The composer: pick the room, then say the thing. The tier is one
 * deliberate act before writing (DD-016), and the audience it means is
 * spelled out under the box, so nobody learns who could read a comment
 * after they posted it.
 */
function Composer({
  entityType,
  entityId,
  role,
  onPosted,
}: Readonly<{
  entityType: CommentEntityType;
  entityId: string;
  role: Role;
  onPosted: (comment: Comment) => void;
}>) {
  const intl = useIntl();
  const tiers = composerTiers(role);
  const [tier, setTier] = useState<CommentTier>(RECORD_DEFAULT_TIER);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** One post at a time. A ref, not state: two submits in one tick read
   * the same pre-render state value and both would pass. */
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = draft.trim();
    if (body === "" || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api
      .POST("/api/v1/comments", { body: { entityType, entityId, body, visibility: tier } })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "comments.postError",
            defaultMessage: "The comment could not be posted. Try again.",
          }),
      );
      return;
    }
    onPosted(data.comment);
    setDraft("");
  }

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-border-muted px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex w-fit gap-0.5 rounded-button bg-control p-0.5">
        <legend className="sr-only">
          {intl.formatMessage({ id: "comments.tierGroup", defaultMessage: "Audience" })}
        </legend>
        {tiers.map((option) => (
          <label
            key={option}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded-chip px-2.5 py-1 text-xs",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-link",
              option === tier
                ? "border border-border-muted bg-raised font-semibold text-primary"
                : "font-medium text-muted",
            )}
          >
            <input
              type="radio"
              name="comment-tier"
              value={option}
              checked={option === tier}
              onChange={() => setTier(option)}
              className="sr-only"
            />
            {option === "legal_only" && <Lock size={LOCK_SIZE} aria-hidden="true" />}
            {tierLabel(intl, option)}
          </label>
        ))}
      </fieldset>
      <textarea
        aria-label={intl.formatMessage({ id: "comments.composer", defaultMessage: "New comment" })}
        placeholder={intl.formatMessage({
          id: "comments.placeholder",
          defaultMessage: "Add a comment…",
        })}
        value={draft}
        className={TEXTAREA_CLASS}
        onChange={(event) => setDraft(event.target.value)}
      />
      {/* Said before the post, never after (CMT-003). */}
      <p className="text-xs text-muted">{tierAudience(intl, tier)}</p>
      {error && (
        <p role="alert" className="text-xs text-status-danger-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || draft.trim() === ""}>
          <FormattedMessage id="comments.post" defaultMessage="Comment" />
        </Button>
      </div>
    </form>
  );
}
