// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bell and the notification centre (NOT-001, NOT-005, DES-048) —
 * from the AppHeader component of designs/final-themes.pen, which draws
 * the glyph and its overhanging count badge in the header's trailing
 * cluster. The panel behind it is unmocked; DES-048 is its anatomy.
 *
 * **The bell is an ephemeral prompt, and the activity feed is the
 * durable history** (NOT-005). So there is no per-item read ceremony
 * here and no per-record notifications surface anywhere — NOT-001
 * removed the contract-details chip. Being shown an item is the only
 * thing that reads it, and this global bell is the only place it is
 * shown.
 *
 * **The badge is the server's number, always.** It is read on mount,
 * again on every navigation, and again on a slow poll — the three
 * moments a stale count is noticed. It is never decremented locally:
 * both writes answer the count that remains, so the badge takes that
 * answer rather than assuming its own request cleared what it sent.
 * Live updates over SSE are M30's, and nothing here anticipates them.
 *
 * **Opening the centre marks the page it drew read** (NOT-005), and so
 * does "Show older" for the page it brings. That is the whole read
 * model: one write per page shown.
 *
 * **The wall is the API's, not this component's.** Both reads and both
 * writes re-apply the confidentiality predicate (DD-014, M10), so an
 * item about a since-walled record is absent from the list, from the
 * count, and from what mark-all-read touches. This surface renders what
 * it is answered and has no filter of its own — which is what makes the
 * omission silent rather than a gap somebody could count.
 */

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { Bell } from "lucide-react";
import { Link, useLocation } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { formatLongDateTime, formatRelativeOrShort } from "../../lib/format";
import { narrateNotification, type BellItem } from "../../lib/notifications";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * How often the badge re-reads itself while the app sits open, in
 * milliseconds.
 *
 * A minute rather than seconds: a notification is a prompt and not an
 * alarm, and the channel that makes an urgent one timely is email
 * (NOT-003). The live channel is M30's; until it exists this is the
 * floor under "updates on poll and navigation", not the mechanism
 * anybody relies on.
 */
const POLL_INTERVAL_MS = 60_000;

/** Above this the badge reads "9+" (NOT-005). The cap is the badge's:
 * the API answers the whole number, and the accessible name says it. */
const BADGE_CAP = 9;

const CENTRE_LABEL = defineMessage({
  id: "notifications.centre",
  defaultMessage: "Notifications",
});

/** The medallion's glyph, at DES-008's inline size — these are DES-026's
 * rows, and that is the size they draw one at. */
const ROW_GLYPH_SIZE = 16;

export function NotificationBell() {
  const intl = useIntl();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  /** null until the first page answers. */
  const [items, setItems] = useState<BellItem[] | null>(null);
  /** Where the next page starts, or null at the end of the bell. */
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Which row focus is owed once the page in flight lands — the count
   * of rows drawn when "Show older" was pressed, so the first new one
   * is at exactly that index (DES-031 clause 4). Null when nothing is
   * owed.
   */
  const [landingIndex, setLandingIndex] = useState<number | null>(null);
  /** Guards the pages against each other: a reopen must not have the
   * previous panel's in-flight page land on top of the new one. */
  const generation = useRef(0);
  const landing = useRef<HTMLAnchorElement | null>(null);
  /** Which landing row focus has already been given to, so the move
   * happens once per page and not again every time the rows are
   * re-rendered under it (the mark-read write does that). */
  const landed = useRef<number | null>(null);

  const readCount = useCallback(async () => {
    const { data } = await api
      .GET("/api/v1/notifications/unread-count")
      .catch(() => ({ data: undefined }));
    // A failed count leaves the badge where it was. It is a number about
    // somewhere else, and the last one that answered is a better guess
    // than zero.
    if (data) setUnread(data.unread);
  }, []);

  // Mount, then every navigation. `pathname` rather than the whole
  // location, so a query-string edit on the same page is not a reason to
  // ask again.
  useEffect(() => {
    void readCount();
  }, [readCount, location.pathname]);

  // And a slow poll under both, for the tab left open on one page.
  useEffect(() => {
    const timer = setInterval(() => void readCount(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [readCount]);

  /**
   * Marks a page's unread items read and takes the badge from the
   * answer.
   *
   * Only the unread ones are sent: the write is idempotent on the
   * server, but a page redrawn after a reopen would otherwise be a
   * request that could only ever change nothing.
   */
  const markPageRead = useCallback(async (page: readonly BellItem[]) => {
    const ids = page.filter((item) => item.readAt === null).map((item) => item.id);
    if (ids.length === 0) return;
    const { data } = await api
      .POST("/api/v1/notifications/read", { body: { ids } })
      .catch(() => ({ data: undefined }));
    if (!data) return;
    setUnread(data.unread);
    // The rows follow the write, so a second draw of the same page sends
    // nothing and the panel agrees with the badge.
    const marked = new Set(ids);
    const readAt = new Date().toISOString();
    setItems((current) =>
      (current ?? []).map((item) => (marked.has(item.id) ? { ...item, readAt } : item)),
    );
  }, []);

  const loadPage = useCallback(
    async (from: string | null) => {
      const mine = from === null ? (generation.current += 1) : generation.current;
      setBusy(true);
      setLoadFailed(false);
      // A first page drops what the last read answered: a reopen that
      // fails must not leave the previous list on screen as current.
      if (from === null) {
        setItems(null);
        setCursor(null);
        setLandingIndex(null);
        landed.current = null;
      }
      const { data } = await api
        .GET("/api/v1/notifications", { params: { query: from ? { cursor: from } : {} } })
        .catch(() => ({ data: undefined }));
      if (mine !== generation.current) return;
      setBusy(false);
      if (!data) {
        setLoadFailed(true);
        return;
      }
      setItems((current) =>
        from === null ? data.notifications : [...(current ?? []), ...data.notifications],
      );
      setCursor(data.nextCursor);
      // Shown is read (NOT-005). After the rows are on screen rather
      // than before, so a page that never arrived is never marked.
      await markPageRead(data.notifications);
    },
    [markPageRead],
  );

  // Opening is what draws the centre, so opening is what reads it. Every
  // open re-reads: a panel opened twice in a long session must not show
  // the first open's answer.
  useEffect(() => {
    if (open) void loadPage(null);
  }, [open, loadPage]);

  // DES-031 clause 4: focus lands on the first row of the page just
  // brought, so a keyboard reader is told the list grew and a screen
  // reader starts reading at the answer. It waits for the list to have
  // actually grown — the ref cannot point at a row that is not drawn.
  useEffect(() => {
    if (landingIndex === null || (items?.length ?? 0) <= landingIndex) return;
    if (landed.current === landingIndex) return;
    landed.current = landingIndex;
    landing.current?.focus();
  }, [landingIndex, items]);

  const showOlder = useCallback(() => {
    if (cursor === null) return;
    setLandingIndex(items?.length ?? 0);
    void loadPage(cursor);
  }, [cursor, items, loadPage]);

  const markAllRead = useCallback(async () => {
    const { data } = await api
      .POST("/api/v1/notifications/read-all")
      .catch(() => ({ data: undefined }));
    if (!data) return;
    setUnread(data.unread);
    const readAt = new Date().toISOString();
    setItems((current) =>
      (current ?? []).map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
    );
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        // The count is in the name and it is uncapped: "9+" is how the
        // badge is drawn, and a screen-reader user is owed the number.
        aria-label={intl.formatMessage(
          {
            id: "notifications.bell",
            defaultMessage:
              "Notifications, {count, plural, =0 {none unread} one {# unread} other {# unread}}",
          },
          { count: unread },
        )}
        // 24×24 around a 20px glyph is DES-011's minimum hit target;
        // the focus ring is the base layer's, as it is on the avatar
        // trigger beside it.
        className="relative flex size-6 items-center justify-center rounded-button text-(--chrome-nav-muted) hover:text-on-inverted"
      >
        <Bell size={20} aria-hidden="true" />
        {/* Overhangs the glyph's trailing top corner, as the AppHeader
            frame draws it. Decorative: the trigger's name already says
            the number, and hearing it twice is noise. */}
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-badge-alert-bg px-1 text-xs font-semibold text-badge-alert-fg"
          >
            {unread > BADGE_CAP ? (
              <FormattedMessage
                id="notifications.badgeCapped"
                defaultMessage="{cap}+"
                values={{ cap: intl.formatNumber(BADGE_CAP) }}
              />
            ) : (
              intl.formatNumber(unread)
            )}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        aria-label={intl.formatMessage(CENTRE_LABEL)}
        className="flex max-h-(--radix-popover-content-available-height) w-(--width-panel) max-w-(--radix-popover-content-available-width) flex-col"
      >
        {/* The applet panel's 44px head, which is this app's one panel
            head (DES-016). */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-muted px-4">
          <h2 className="text-base font-semibold">
            <FormattedMessage {...CENTRE_LABEL} />
          </h2>
          {/* Drawn only while there is something to clear: a control
              that can only ever do nothing is chrome, not an
              affordance. */}
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="-me-2" onClick={() => void markAllRead()}>
              <FormattedMessage id="notifications.markAllRead" defaultMessage="Mark all read" />
            </Button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Two failures, and they leave the reader in different
              places. A first page that fails has no list and no control
              to retry with, so reopening the centre is the way back. A
              failed "Show older" keeps the list and the button, so the
              retry is the control already under their hand (DES-026). */}
          {loadFailed && items === null && (
            <p role="alert" className="px-4 py-3 text-sm text-status-danger-fg">
              <FormattedMessage
                id="notifications.loadError"
                defaultMessage="Notifications could not be read. Close this and open it again."
              />
            </p>
          )}
          {items !== null && items.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">
              <FormattedMessage
                id="notifications.empty"
                defaultMessage="Nothing to catch up on. News about your records shows up here."
              />
            </p>
          )}
          {items !== null && items.length > 0 && (
            <ol>
              {items.map((item, index) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onNavigate={() => setOpen(false)}
                  ref={index === landingIndex ? landing : undefined}
                />
              ))}
            </ol>
          )}
          {loadFailed && items !== null && (
            <p role="alert" className="px-4 pt-3 text-sm text-status-danger-fg">
              <FormattedMessage
                id="notifications.olderError"
                defaultMessage="The older notifications could not be read. Try again."
              />
            </p>
          )}
          {/* DES-026's foot: drawn while a further page exists, and
              absent — not disabled — when the list is complete. */}
          {cursor !== null && (
            <div className="px-4 py-3">
              <Button variant="secondary" disabled={busy} onClick={showOlder}>
                <FormattedMessage id="notifications.older" defaultMessage="Show older" />
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One item (DES-026's row, DES-048): a 24px medallion carrying the
 * event family's glyph, then the prompt, then the timestamp.
 *
 * **The whole row is the link.** An item exists to be acted on and it
 * carries exactly one action, so a link inside the row would be a
 * smaller target for the same destination (DES-011).
 *
 * **No unread marker.** Opening the centre reads everything it draws
 * (NOT-005), so a per-item mark would be a dot that goes out while the
 * reader watches it. The badge is where unread is said.
 */
function NotificationRow({
  item,
  onNavigate,
  ref,
}: Readonly<{
  item: BellItem;
  /** Closes the centre: the reader asked to go somewhere, and a panel
   * left open over the record they landed on is clutter. */
  onNavigate: () => void;
  /** Set on the first row of a page "Show older" brought, so focus can
   * land there (DES-031). */
  ref?: Ref<HTMLAnchorElement>;
}>) {
  const intl = useIntl();
  const { icon: Icon, sentence, href } = narrateNotification(intl, item);

  const face = (
    <>
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-control text-muted"
      >
        <Icon size={ROW_GLYPH_SIZE} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-primary">{sentence}</span>
        <time
          dateTime={item.createdAt}
          title={formatLongDateTime(item.createdAt, { locale: intl.locale })}
          className="text-xs text-muted"
        >
          {formatRelativeOrShort(item.createdAt, { locale: intl.locale })}
        </time>
      </span>
    </>
  );

  return (
    <li className="border-b border-border-muted last:border-b-0">
      {href === null ? (
        // Unreachable while `contract` is the only entity the API
        // answers for, and the honest drawing if a later record type
        // ever reaches this panel before its route does: a prompt that
        // says what happened beats a link to nowhere.
        <div className="flex gap-2.5 px-4 py-2.5">{face}</div>
      ) : (
        <Link
          ref={ref}
          to={href}
          onClick={onNavigate}
          // The base layer's ring, pulled inside the row: a full-width
          // row's outward offset would be clipped by the scrolling
          // list it sits in.
          className="flex gap-2.5 px-4 py-2.5 hover:bg-control focus-visible:-outline-offset-2"
        >
          {face}
        </Link>
      )}
    </li>
  );
}
