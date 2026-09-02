// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request thread (CMT-001, INT-007, #381), from the I7 frame of
 * intake.pen: the Conversation card between the status banner and "What
 * you submitted".
 *
 * It is the same thread the staff applet draws, read through the same
 * routes, and it is a second surface rather than a second machinery: one
 * `request` audience arm answers who is in the room, and this component
 * only decides how the portal says it.
 *
 * **The thread is live from submission** (INT-007). A Request that is
 * still `new` takes the clarifying back-and-forth, so the card draws
 * whatever the status is and consults none of them.
 *
 * **And it stays live after a conversion, on the record** (CMT-001,
 * #422). A conversion moves the comment rows onto the contract the
 * Request became, and the `request` audience arm follows that
 * back-link. So this card goes on asking for the thread by the
 * Request's own id, and the answer it gets is the record's
 * conversation. There is no branch here and no second address: which
 * record the rows hang off is the seam's answer, and a card that had to
 * know would be a second place for CMT-001 to be forgotten.
 *
 * **Everything here is Full Thread, and that is the API's doing rather
 * than this component's.** The `request` arm puts a Requester in one
 * room (DD-016), so the read already carries Full Thread comments alone
 * — a Legal Only note never leaves the database — and a post at any
 * other tier would be refused. That is why the composer has no tier
 * picker: a chooser with one option is not a choice, and drawing three
 * segments would offer two rooms nobody would be let into.
 *
 * **No badge, no tier badges, and no corrections.** The portal is one
 * room, so a badge naming it would name the only room there is. The
 * three corrections (CMT-008) are a staff affordance the mock does not
 * draw, and a requester who wants to take something back replies again.
 *
 * ### Recorded normalization points (I7 deviations accepted)
 *
 * 1. I7's "Attach a file" becomes CMT-011's shared chosen-file control:
 *    up to five removable chips, with each posted file drawn under the
 *    reply it travelled with.
 * 2. I7 draws every message in one body with no end to it. The read is
 *    paged from the newest end (CTR-024), so a thread past one page
 *    carries a control that walks back into the older conversation.
 *    Without it a long thread would silently lose its own beginning.
 * 3. I7's author pill reads "You" or "Legal". Both are kept, because on
 *    a Request the audience is the Requester plus Member+ staff and
 *    there is nobody else an author could be.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import {
  mergeCommentWindow,
  readCommentWindow,
  sendComment,
  type Comment,
} from "../../lib/comments";
import { formatLongDateTime, formatRelativeOrShort } from "../../lib/format";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { problem as readProblem } from "../../lib/problem";
import { subscribeLiveEvents } from "../../lib/events";
import { cn } from "../../lib/utils";
import { Avatar } from "../avatar";
import { CommentAttachmentRows, CommentFilePicker } from "../comments/comment-attachments";
import { Button } from "../ui/button";

/** The thread as the loader read it: the newest page, and where the page
 * before it starts. `null` where the read failed — the card still draws,
 * because the composer is a live affordance whether or not the
 * conversation could be fetched. */
export interface LoadedThread {
  comments: Comment[];
  nextCursor: string | null;
}

export function RequestThread({
  requestId,
  viewerId,
  thread,
}: Readonly<{
  /** The Request the thread hangs off, by its own id — the reference
   * every comment route is keyed by (CMT-010), never the R-### number. */
  requestId: string;
  /** Who is reading, so a row can say "You" of its own author. */
  viewerId: string;
  thread: LoadedThread | null;
}>) {
  const [comments, setComments] = useState<Comment[]>(thread?.comments ?? []);
  const commentsRef = useRef<Comment[]>(thread?.comments ?? []);
  const [cursor, setCursor] = useState<string | null>(thread?.nextCursor ?? null);
  const [olderFailed, setOlderFailed] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [readFailed, setReadFailed] = useState(thread === null);
  /** The message that should take focus once it is on screen, or `null`
   * when nothing is waiting for it. */
  const [landed, setLanded] = useState<string | null>(null);
  const newestIssued = useRef(0);
  const newestLanded = useRef(0);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  /** A frame carries no reply text, so the open portal card asks the
   * existing Full Thread read through the oldest row already on screen
   * and adopts the corrected window. */
  const refreshNewest = useCallback(async () => {
    const issue = (newestIssued.current += 1);
    const throughId = commentsRef.current[0]?.id;
    const data = await readCommentWindow("request", requestId, throughId);
    if (issue < newestLanded.current) return;
    newestLanded.current = issue;
    if (!data) {
      setReadFailed(true);
      return;
    }
    setReadFailed(false);
    setComments((current) => mergeCommentWindow(current, data.comments));
    if (commentsRef.current[0]?.id === throughId) setCursor(data.nextCursor);
  }, [requestId]);

  useEffect(
    () =>
      subscribeLiveEvents((event) => {
        if (
          event.kind === "open" ||
          (event.kind === "record" && event.action.startsWith("comment."))
        ) {
          // The server already scoped this tab to the Request and, after
          // conversion, to the record holding its moved thread. The
          // frame may therefore name a Contract or Matter while this
          // stable portal address still asks by Request id.
          void refreshNewest();
        }
      }),
    [refreshNewest],
  );

  /**
   * One page further back, prepended in place (CTR-024).
   *
   * The older comments go on the head of the thread rather than the
   * foot: the thread reads oldest to newest, so what came before belongs
   * above what is already there.
   */
  async function loadOlder() {
    if (cursor === null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const { data } = await api
      .GET("/api/v1/comments", {
        params: { query: { entityType: "request", entityId: requestId, cursor } },
      })
      .catch(() => ({ data: undefined }))
      .finally(() => setLoadingOlder(false));
    if (!data) {
      setOlderFailed(true);
      return;
    }
    setComments((current) => [...data.comments, ...current]);
    setCursor(data.nextCursor);
    // Where focus goes now. Reaching the start of the thread unmounts
    // the control that was just pressed, and focus would fall to the
    // document — so the oldest message that arrived catches it, which is
    // also the first thing the reader asked to see. DES-010 asks for
    // focus to be placed by hand wherever no overlay owns it.
    setLanded(data.comments[0]?.id ?? null);
  }

  return (
    <section
      aria-labelledby="portal-request-thread-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      {/* A `div` rather than a `header`, the submitted card's rule: the
          portal draws one banner, and a card strip that also claimed the
          role would make "the page header" mean two things. */}
      <div className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id="portal-request-thread-heading" className="text-base font-semibold">
          <FormattedMessage id="portal.request.threadHeading" defaultMessage="Conversation" />
        </h2>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {readFailed && (
          <p role="alert" className="text-sm text-status-danger-fg">
            <FormattedMessage
              id="portal.request.threadFailed"
              defaultMessage="The conversation could not be read. Reload the page to try again."
            />
          </p>
        )}
        {cursor !== null && (
          <div className="flex flex-col items-start gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              <FormattedMessage
                id="portal.request.threadOlder"
                defaultMessage="Show earlier replies"
              />
            </Button>
            {olderFailed && (
              <p role="alert" className="text-sm text-status-danger-fg">
                <FormattedMessage
                  id="portal.request.threadOlderFailed"
                  defaultMessage="The earlier replies could not be read. Try again."
                />
              </p>
            )}
          </div>
        )}
        {comments.length > 0 && (
          <ul className="flex flex-col gap-4">
            {comments.map((comment) => (
              <Message
                key={comment.id}
                comment={comment}
                viewerId={viewerId}
                landed={comment.id === landed}
                requestId={requestId}
              />
            ))}
          </ul>
        )}
        <Composer
          requestId={requestId}
          onPosted={(comment) => setComments((current) => [...current, comment])}
        />
      </div>
    </section>
  );
}

/** What a removed comment says in its place (CMT-008). The row keeps its
 * seat so the conversation around it still reads, and the two tombstones
 * carry different sentences: an author taking their own words back and
 * an Administrator removing text from the record are different facts. */
const TOMBSTONE = {
  deleted: defineMessage({
    id: "comments.tombstone.deleted",
    defaultMessage: "Comment deleted by its author.",
  }),
  redacted: defineMessage({
    id: "comments.tombstone.redacted",
    defaultMessage: "Comment removed by an Administrator.",
  }),
} as const;

/** One message: who said it, when, and what they said. */
function Message({
  comment,
  viewerId,
  landed,
  requestId,
}: Readonly<{
  comment: Comment;
  viewerId: string;
  /** Whether this is the message focus is waiting on — the oldest one a
   * "Show earlier replies" press just brought in. */
  landed: boolean;
  /** The portal address that resolved the thread, including after conversion. */
  requestId: string;
}>) {
  const intl = useIntl();
  const mine = comment.author.id === viewerId;
  /** Redacted wins where both happened: the Administrator's act is the
   * later fact, and it is the one that took the text away for good. */
  const removed = comment.redactedAt ? "redacted" : comment.deletedAt ? "deleted" : null;
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (landed) row.current?.focus();
  }, [landed]);

  return (
    <li
      ref={row}
      // Not in the tab order — a reader tabs through the card's
      // controls, not its messages — but focusable by hand, so the
      // paging control has somewhere to hand focus once it is gone.
      tabIndex={-1}
      className="flex gap-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
    >
      <Avatar name={comment.author.displayName} image={comment.author.image} className="size-6" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-base font-semibold", comment.author.archived && "opacity-50")}>
            {comment.author.displayName}
          </span>
          {/* I7's author pill. On a Request the audience is the Requester
              plus Member+ staff, so anybody who is not the reader is
              Legal — there is no third kind of author to be wrong
              about. */}
          <span className="inline-flex shrink-0 rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
            {mine ? (
              <FormattedMessage id="portal.request.threadYou" defaultMessage="You" />
            ) : (
              <FormattedMessage id="portal.request.threadLegal" defaultMessage="Legal" />
            )}
          </span>
          <time
            dateTime={comment.createdAt}
            title={formatLongDateTime(comment.createdAt, { locale: intl.locale })}
            className="text-sm text-muted"
          >
            {formatRelativeOrShort(comment.createdAt, { locale: intl.locale })}
          </time>
          {/* Only while there is text to have been edited. A tombstone
              saying "edited" would be reporting on nothing. */}
          {comment.editedAt !== null && removed === null && (
            <span
              className="text-sm text-muted"
              title={formatLongDateTime(comment.editedAt, { locale: intl.locale })}
            >
              <FormattedMessage id="comments.edited" defaultMessage="edited" />
            </span>
          )}
        </div>
        {removed === null ? (
          // User-generated text: the line breaks somebody typed are part
          // of what they said (DES-015).
          <p className="text-base break-words whitespace-pre-line">{comment.body}</p>
        ) : (
          <p className="text-base text-muted italic">
            <FormattedMessage {...TOMBSTONE[removed]} />
          </p>
        )}
        {removed === null && (
          <CommentAttachmentRows comment={comment} entityType="request" entityId={requestId} />
        )}
      </div>
    </li>
  );
}

/**
 * The reply box (I7).
 *
 * It posts Full Thread and offers nothing else. The tier is not a
 * hidden default the portal happens to send: it is the only room a
 * Requester is in (DD-016), and the seam refuses every other one, so the
 * absent picker is the truth about the surface rather than a shortcut
 * through it.
 */
function Composer({
  requestId,
  onPosted,
}: Readonly<{ requestId: string; onPosted: (comment: Comment) => void }>) {
  const intl = useIntl();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One reply per submit. A second Enter while the first is in flight
   * would post the same words twice, and a thread cannot take one of
   * them back. */
  const inFlight = useRef(false);

  async function post() {
    const body = draft.trim();
    if (body === "" || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await sendComment(
      {
        entityType: "request",
        entityId: requestId,
        body,
        visibility: "full_thread",
      },
      files,
    )
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
    if (!result?.data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "portal.request.replyError",
            defaultMessage: "The reply could not be sent. Try again.",
          }),
      );
      return;
    }
    onPosted(result.data.comment);
    // Only once it landed: a refusal leaves the words in the box, where
    // the person who wrote them can send them again.
    setDraft("");
    setFiles([]);
  }

  return (
    <form
      id="portal-request-composer"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <textarea
        aria-label={intl.formatMessage({
          id: "portal.request.replyLabel",
          defaultMessage: "Reply to Legal",
        })}
        placeholder={intl.formatMessage({
          id: "portal.request.replyPlaceholder",
          defaultMessage: "Reply to Legal…",
        })}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        className={TEXTAREA_CLASS}
      />
      <CommentFilePicker files={files} disabled={busy} onChange={setFiles} />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || draft.trim() === ""}>
          <FormattedMessage id="portal.request.replySend" defaultMessage="Send" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
    </form>
  );
}
