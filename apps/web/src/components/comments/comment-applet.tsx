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
 *
 * Typing `@` opens the mention typeahead (M9/3, CMT-007). It offers the
 * people a comment on this record can reach, and picking one writes
 * their name into the box and adds them to the list the post carries.
 * A mention that outruns the selected tier raises the promotion
 * confirmation: it names who cannot hear it, offers the narrowest tier
 * that includes them, and posts nothing if it is cancelled. The
 * confirmation explains; the seam is what enforces.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FormattedMessage, defineMessage, useIntl, type IntlShape } from "react-intl";
import { Lock, MessageSquare, X } from "lucide-react";
import { api } from "../../lib/api";
import {
  composerTiers,
  mentionText,
  namedInDraft,
  narrowestTierFor,
  RECORD_DEFAULT_TIER,
  tierAudience,
  tierLabel,
  unreachableAt,
  withoutMention,
  type Comment,
  type CommentEntityType,
  type CommentMention,
  type CommentTier,
  type MentionCandidate,
} from "../../lib/comments";
import { formatLongDateTime, formatRelativeOrShort } from "../../lib/format";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { problemDetail } from "../../lib/messages";
import type { Role } from "../../lib/roles";
import { cn } from "../../lib/utils";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import type { Applet } from "../shell/applets";

const CHAT_LABEL = defineMessage({ id: "comments.applet", defaultMessage: "Comments" });

/** The lock is DES-009's glyph at DES-009's own inline size (12–14px),
 * not DES-008's 16/20/24 ramp: it rides inside an 11px badge, where a
 * 16px glyph would be taller than the text it marks. */
const LOCK_SIZE = 12;

/** The remove control on a mention chip. Same reasoning as the lock: it
 * rides inside a chip, where DES-008's 16px floor would outgrow it. */
const CHIP_GLYPH_SIZE = 12;

/**
 * How far past the `@` the typeahead keeps looking. Display names carry
 * spaces, so the query cannot stop at the first one; a bound is what
 * keeps a paragraph typed after a stray `@` from being treated as a
 * search. Nothing matches long before this, and a query that matches
 * nothing closes the list anyway.
 */
const MAX_MENTION_QUERY = 40;

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
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    // Drop what the last read answered before asking again. A reopen
    // that fails must not leave the previous thread — or its count — on
    // screen as though it were current.
    setComments(null);
    // The people this record can address come down with the thread. The
    // list is one working group, so it costs a small read once, and the
    // typeahead is instant when the `@` is typed rather than waiting on
    // a request at the moment somebody is being addressed.
    const [thread, people] = await Promise.all([
      api
        .GET("/api/v1/comments", { params: { query: { entityType, entityId } } })
        .catch(() => ({ data: undefined })),
      api
        .GET("/api/v1/comments/mention-candidates", { params: { query: { entityType, entityId } } })
        .catch(() => ({ data: undefined })),
    ]);
    setCandidates(people.data?.candidates ?? []);
    if (!thread.data) {
      setLoadFailed(true);
      return;
    }
    setComments(thread.data.comments);
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
        candidates={candidates}
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
  candidates,
  loadFailed,
  onLoad,
  onPosted,
}: Readonly<{
  entityType: CommentEntityType;
  entityId: string;
  role: Role;
  /** null until the first read answers. */
  comments: readonly Comment[] | null;
  candidates: readonly MentionCandidate[];
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
      <Composer
        entityType={entityType}
        entityId={entityId}
        role={role}
        candidates={candidates}
        onPosted={onPosted}
      />
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
      <p className="text-sm whitespace-pre-wrap text-primary">
        <MentionedBody body={comment.body} mentions={comment.mentions} />
      </p>
    </li>
  );
}

/** Escapes a display name for use inside a regular expression. Names
 * are people's, so they carry brackets, dots, and parentheses. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A posted comment's text, with each mention drawn as a chip so it
 * reads as a person rather than as raw text.
 *
 * The comment stays plain text (CMT-007), and the list of who it
 * addresses travels beside it. This matches the two up: a name in the
 * list is chipped where the body says it. A person renamed since the
 * comment was posted no longer matches, and their `@Old Name` stays as
 * the author typed it — the record of what was said does not change
 * because somebody changed their name.
 */
function MentionedBody({
  body,
  mentions,
}: Readonly<{ body: string; mentions: readonly CommentMention[] }>) {
  if (mentions.length === 0) return body;
  // Longest first, so "@Casey Contributor" wins over a "@Casey" who is
  // also in the list rather than leaving half a name behind.
  const names = [...new Set(mentions.map((person) => person.displayName))].sort(
    (left, right) => right.length - left.length,
  );
  const pattern = new RegExp(`(@(?:${names.map(escapeForPattern).join("|")}))`, "g");
  // A capturing split alternates: plain text at the even indices, a
  // matched mention at the odd ones.
  return body.split(pattern).map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      // The split's own position is the only identity a text run has,
      // and the list is rebuilt whole whenever the body changes.
      <MentionChip key={index} name={part} />
    ),
  );
}

/** One mention, as a person rather than as `@` and some letters. */
function MentionChip({ name }: Readonly<{ name: string }>) {
  return (
    <span className="rounded-chip bg-badge-count-bg px-1 font-medium text-badge-count-fg">
      {name}
    </span>
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
 *
 * Typing `@` opens the typeahead over the people this record can reach.
 * Picking somebody writes their name into the box and puts them on the
 * list the post carries — the body stays plain text, and who it
 * addresses is a list beside it (CMT-007). Deleting the name from the
 * box takes the mention back, so the two can never disagree.
 *
 * On submit, a mention the selected tier cannot reach raises the
 * promotion confirmation rather than a refusal. It names who cannot
 * hear it, offers the narrowest tier that includes everybody named, and
 * on cancel leaves the box exactly as it was. Promotion is a choice.
 */
function Composer({
  entityType,
  entityId,
  role,
  candidates,
  onPosted,
}: Readonly<{
  entityType: CommentEntityType;
  entityId: string;
  role: Role;
  candidates: readonly MentionCandidate[];
  onPosted: (comment: Comment) => void;
}>) {
  const intl = useIntl();
  const tiers = composerTiers(role);
  const [tier, setTier] = useState<CommentTier>(RECORD_DEFAULT_TIER);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Everybody picked from the typeahead so far. The draft is what says
   * whether they are still named — see `namedInDraft`. */
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  /** The `@…` being typed at the caret, or null when there is none. */
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  /** The promotion the author has been asked about, or null. */
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  /** Where the caret goes after a pick, applied once the box re-renders
   * with the inserted name. */
  const [caret, setCaret] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const listboxId = useId();
  /** One post at a time. A ref, not state: two submits in one tick read
   * the same pre-render state value and both would pass. */
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (caret === null) return;
    setCaret(null);
    const element = box.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [caret]);

  const matches = query
    ? candidates.filter((person) =>
        person.displayName.toLowerCase().includes(query.text.toLowerCase()),
      )
    : [];
  const open = matches.length > 0;
  const active = Math.min(activeIndex, matches.length - 1);
  const rowId = (index: number) => `${listboxId}-row-${index}`;

  /** Who the comment addresses as it stands — picked, and still named. */
  const named = namedInDraft(draft, picked);

  function retype(value: string, at: number) {
    setDraft(value);
    setQuery(mentionQueryAt(value, at));
    setActiveIndex(0);
  }

  function pick(person: MentionCandidate) {
    if (!query) return;
    const before = draft.slice(0, query.start);
    const after = draft.slice(query.start + 1 + query.text.length);
    // The trailing space is what lets the next word be typed straight
    // on, and what keeps the name from running into it.
    const inserted = `${mentionText(person.displayName)} `;
    setDraft(before + inserted + after);
    setPicked((current) =>
      current.some((existing) => existing.id === person.id) ? current : [...current, person],
    );
    setQuery(null);
    setActiveIndex(0);
    setCaret(before.length + inserted.length);
  }

  /** Takes a mention back: out of the list, and out of every place in
   * the text that named them, so nothing is left addressing somebody
   * who is not on the post. */
  function unpick(person: MentionCandidate) {
    setDraft((current) => withoutMention(current, person, picked));
    setPicked((current) => current.filter((existing) => existing.id !== person.id));
    setQuery(null);
  }

  async function post(visibility: CommentTier, mentions: readonly MentionCandidate[]) {
    const body = draft.trim();
    if (body === "" || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api
      .POST("/api/v1/comments", {
        body: {
          entityType,
          entityId,
          body,
          visibility,
          mentions: mentions.map((person) => person.id),
        },
      })
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
    setPicked([]);
    setQuery(null);
  }

  /**
   * What the Comment button does. Everybody named who can hear the
   * selected tier means post it. Anybody who cannot means ask first —
   * and if no tier this author may post reaches them all, say so rather
   * than offer a promotion that would not work.
   */
  function requestPost() {
    if (draft.trim() === "" || inFlight.current) return;
    const blocked = unreachableAt(named, tier);
    if (blocked.length === 0) {
      void post(tier, named);
      return;
    }
    // Promotion widens. Tiers narrower than the one selected are off
    // the table, so the offer can never quietly shrink the audience an
    // author already chose.
    const promoted = narrowestTierFor(named, tiers.slice(tiers.indexOf(tier)));
    if (!promoted) {
      setError(
        intl.formatMessage(
          {
            id: "comments.mention.unreachable",
            defaultMessage:
              "{names} cannot be reached on this record at any audience you can post to. Take the mention out.",
          },
          { names: nameList(intl, blocked) },
        ),
      );
      return;
    }
    setError(null);
    setPromotion({ tier: promoted, blocked });
  }

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-border-muted px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        requestPost();
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
      <div className="relative">
        <textarea
          ref={box}
          aria-label={intl.formatMessage({
            id: "comments.composer",
            defaultMessage: "New comment",
          })}
          placeholder={intl.formatMessage({
            id: "comments.placeholder",
            defaultMessage: "Add a comment…",
          })}
          value={draft}
          className={TEXTAREA_CLASS}
          // The box stays a textbox. ARIA in HTML permits no other role
          // on a `textarea`, so this is not the counterparty picker's
          // combobox: `aria-autocomplete` and `aria-activedescendant`
          // are supported on `textbox` and carry the active row, and
          // the live region below says the list is there — the pattern
          // an inline mention typeahead has to use (DES-024).
          aria-controls={listboxId}
          aria-activedescendant={open ? rowId(active) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(event) => retype(event.target.value, event.target.selectionStart)}
          // Arrow keys and clicks move the caret without changing the
          // text, and the `@` under it may be a different one.
          onSelect={(event) => {
            if (query === null) return;
            const element = event.currentTarget;
            setQuery(mentionQueryAt(element.value, element.selectionStart));
          }}
          onBlur={() => setQuery(null)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex((active + delta + matches.length) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              // Enter in an open list picks a name; it does not send a
              // half-written comment.
              event.preventDefault();
              pick(matches[active]!);
              return;
            }
            if (event.key === "Escape") {
              // Local dismiss, as DES-010 reserves the key for.
              event.preventDefault();
              event.stopPropagation();
              setQuery(null);
            }
          }}
        />
        <ul // NOSONAR — a select cannot narrow as a name is typed
          id={listboxId}
          role="listbox"
          aria-label={intl.formatMessage({
            id: "comments.mention.listLabel",
            defaultMessage: "People you can mention",
          })}
          className={cn(
            "absolute bottom-full z-10 mb-1 max-h-48 w-full overflow-y-auto rounded-card border border-border-default bg-raised py-1",
            !open && "hidden",
          )}
        >
          {matches.map((person, index) => (
            <li
              key={person.id}
              id={rowId(index)}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex cursor-default items-center gap-2 px-2 py-1 text-sm text-primary",
                index === active && "bg-control",
              )}
              // Ahead of the box's own blur, so the pick lands.
              onPointerDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              onMouseMove={() => setActiveIndex(index)}
            >
              <Avatar name={person.displayName} image={person.image} className="size-5" />
              <span className="truncate">{person.displayName}</span>
            </li>
          ))}
        </ul>
        {/* A textbox cannot carry `aria-expanded`, so the list's arrival
            is announced instead of implied. */}
        <p aria-live="polite" className="sr-only">
          {open &&
            intl.formatMessage(
              {
                id: "comments.mention.available",
                defaultMessage:
                  "{count, plural, one {# person matches} other {# people match}}. Use the arrow keys to choose one.",
              },
              { count: matches.length },
            )}
        </p>
      </div>
      {named.length > 0 && (
        <ul
          aria-label={intl.formatMessage({
            id: "comments.mention.pickedLabel",
            defaultMessage: "Mentioned",
          })}
          className="flex flex-wrap gap-1"
        >
          {named.map((person) => (
            <li key={person.id}>
              <span className="inline-flex items-center gap-1 rounded-chip bg-badge-count-bg py-px ps-1.5 pe-px text-xs font-medium text-badge-count-fg">
                {person.displayName}
                <button
                  type="button"
                  // 24×24 is DES-011's minimum hit target, so the 12px
                  // glyph carries its own padding rather than being one.
                  className="inline-flex size-6 items-center justify-center rounded-chip text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                  aria-label={intl.formatMessage(
                    {
                      id: "comments.mention.remove",
                      defaultMessage: "Remove {name}",
                    },
                    { name: person.displayName },
                  )}
                  onClick={() => unpick(person)}
                >
                  <X size={CHIP_GLYPH_SIZE} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
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
      <PromotionDialog
        promotion={promotion}
        current={tier}
        onCancel={() => setPromotion(null)}
        onConfirm={() => {
          if (!promotion) return;
          setPromotion(null);
          setTier(promotion.tier);
          void post(promotion.tier, named);
        }}
      />
    </form>
  );
}

/** The `@…` under the caret: where the `@` is, and what has been typed
 * after it. */
interface MentionQuery {
  start: number;
  text: string;
}

/** What the author has been asked to agree to: the tier to promote to,
 * and who the tier they picked would have left out. */
interface Promotion {
  tier: CommentTier;
  blocked: readonly MentionCandidate[];
}

/**
 * The `@…` the caret sits in, or null when it sits in none.
 *
 * An `@` counts only at the start of the text or after whitespace, so
 * an email address is not a mention. The query runs from there to the
 * caret and stops at a newline, because a mention is one line's worth
 * of name.
 */
function mentionQueryAt(value: string, caret: number | null): MentionQuery | null {
  if (caret === null) return null;
  const upToCaret = value.slice(0, caret);
  const start = upToCaret.lastIndexOf("@");
  if (start === -1) return null;
  if (start > 0 && !/\s/.test(upToCaret[start - 1]!)) return null;
  const text = upToCaret.slice(start + 1);
  if (text.length > MAX_MENTION_QUERY || text.includes("\n")) return null;
  return { start, text };
}

/** People named in a sentence, in the reader's own list convention. */
function nameList(intl: IntlShape, people: readonly MentionCandidate[]): string {
  return intl.formatList(
    people.map((person) => person.displayName),
    { type: "conjunction" },
  );
}

/**
 * The promotion confirmation (DD-016, CMT-007). It names who cannot
 * hear the comment, offers the narrowest tier that includes them, and
 * says what cancelling does. Cancelling posts nothing and leaves the
 * box exactly as it was, so changing the mention is as available as
 * widening the room.
 */
function PromotionDialog({
  promotion,
  current,
  onCancel,
  onConfirm,
}: Readonly<{
  promotion: Promotion | null;
  current: CommentTier;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const intl = useIntl();
  return (
    <Dialog open={promotion !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="comments.promote.title" defaultMessage="Widen the audience?" />
        </DialogTitle>
        {promotion && (
          <>
            <p className="mt-4 text-base text-primary">
              <FormattedMessage
                id="comments.promote.body"
                defaultMessage="{names} cannot see a {current} comment. Post it at {promoted} instead to reach {count, plural, one {them} other {all of them}}."
                values={{
                  names: nameList(intl, promotion.blocked),
                  current: tierLabel(intl, current).toLocaleLowerCase(intl.locale),
                  promoted: tierLabel(intl, promotion.tier).toLocaleLowerCase(intl.locale),
                  count: promotion.blocked.length,
                }}
              />
            </p>
            {/* The audience the promotion means, in the same words the
                composer's own line uses — said before the post, never
                after (CMT-003). */}
            <p className="mt-2 text-sm text-muted">{tierAudience(intl, promotion.tier)}</p>
          </>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button type="button" onClick={onConfirm}>
            <FormattedMessage id="comments.promote.confirm" defaultMessage="Widen and post" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
