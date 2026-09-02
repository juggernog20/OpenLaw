// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bell and the notification centre (NOT-001, NOT-005, DES-049) —
 * from the AppHeader component of designs/final-themes.pen, which draws
 * the glyph and its overhanging count badge in the header's trailing
 * cluster. The panel behind it is unmocked; DES-049 is its anatomy.
 *
 * **One component, two bells** (M20/9). NOT-001 puts one notification
 * system on two rendering surfaces — the staff notification centre in
 * the application header, and the portal bell in the portal's own
 * chrome — and DES-049 says in its own words that the portal renders
 * the same anatomy. So `surface` is the whole of the difference: which
 * four routes are asked, what the empty panel says, and how the trigger
 * is coloured for the chrome it sits in. Everything else — the badge and
 * its cap, read-on-open, paging, the focus landing, both failure states
 * — is written once, because it is one decision and not two.
 *
 * **The two bells never see each other's items.** The scope is the API's
 * (`NotificationSurface`), not this component's: the staff mount answers
 * rows about contracts and the portal mount answers rows about the
 * reader's own Requests. A person who is both a Member+ and a Requester
 * has two bells with two badges, and marking one read leaves the other
 * exactly as it was.
 *
 * **The bell is an ephemeral prompt, and the activity feed is the
 * durable history** (NOT-005). So there is no per-item read ceremony
 * here and no per-record notifications surface anywhere — NOT-001
 * removed the contract-details chip. Being shown an item is the only
 * thing that reads it, and the bell is the only place it is shown.
 *
 * **The badge is the server's number, always.** It is read on mount,
 * again on every navigation, and on the shared channel's bell and open
 * frames. It is never decremented locally:
 * both writes answer the count that remains, so the badge takes that
 * answer rather than assuming its own request cleared what it sent.
 * A bell frame re-asks the count and refreshes an open centre. The
 * browser reconnects the shared EventSource; its next open frame makes
 * this surface re-ask the same reads.
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
import { defineMessage, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { api } from "../lib/api";
import { subscribeLiveEvents } from "../lib/events";
import { formatLongDateTime, formatRelativeOrShort } from "../lib/format";
import { narrateNotification, type BellItem } from "../lib/notifications";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

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

/** Which bell this is (NOT-001): the staff notification centre, or the
 * portal's own. */
export type BellSurface = "staff" | "portal";

/**
 * What the panel says when there is nothing in it.
 *
 * Each surface names the news it carries. The staff line says "news",
 * not "anything that needs you" (DES-049 point 12): NOT-002's ambient
 * group is there too, and a comment posted on your record is news that
 * needs nothing from you. The portal line names the one thing a
 * requester's bell is ever about.
 */
const EMPTY_COPY: Record<BellSurface, MessageDescriptor> = {
  staff: defineMessage({
    id: "notifications.empty",
    defaultMessage: "Nothing to catch up on. News about your records shows up here.",
  }),
  portal: defineMessage({
    id: "notifications.emptyPortal",
    defaultMessage: "Nothing to catch up on. News about your requests shows up here.",
  }),
};

/**
 * How the trigger is coloured for the chrome it sits in.
 *
 * The staff header is the dark chrome strip and takes its own nav
 * tokens; the portal header is a `bg-raised` strip and takes the
 * ordinary foreground pair. The geometry — a 20px glyph in a 24×24
 * target, DES-011's floor — is the same on both.
 */
const TRIGGER_TONE: Record<BellSurface, string> = {
  staff: "text-(--chrome-nav-muted) hover:text-on-inverted",
  portal: "text-muted hover:text-primary",
};

export function NotificationBell({ surface }: Readonly<{ surface: BellSurface }>) {
  const intl = useIntl();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  /** The current popover state for work that resumes after a read. */
  const openNow = useRef(false);
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

  /** Asks for the count. A failed count answers undefined and leaves
   * the badge where it was: it is a number about somewhere else, and
   * the last one that answered is a better guess than zero. */
  const fetchCount = useCallback(async () => {
    const { data } = await (
      surface === "portal"
        ? api.GET("/api/v1/portal/notifications/unread-count")
        : api.GET("/api/v1/notifications/unread-count")
    ).catch(() => ({ data: undefined }));
    return data?.unread;
  }, [surface]);

  const readCount = useCallback(async () => {
    const count = await fetchCount();
    if (count !== undefined) setUnread(count);
  }, [fetchCount]);

  // Mount, then every navigation. `pathname` rather than the whole
  // location, so a query-string edit on the same page is not a reason to
  // ask again. The badge is written only once the answer is back.
  useEffect(() => {
    let live = true;
    void fetchCount().then((count) => {
      if (live && count !== undefined) setUnread(count);
    });
    return () => {
      live = false;
    };
  }, [fetchCount, location.pathname]);

  /**
   * Marks a page's unread items read and takes the badge from the
   * answer.
   *
   * Only the unread ones are sent: the write is idempotent on the
   * server, but a page redrawn after a reopen would otherwise be a
   * request that could only ever change nothing.
   */
  const markPageRead = useCallback(
    async (page: readonly BellItem[]) => {
      const ids = page.filter((item) => item.readAt === null).map((item) => item.id);
      if (ids.length === 0) return;
      const { data } = await (
        surface === "portal"
          ? api.POST("/api/v1/portal/notifications/read", { body: { ids } })
          : api.POST("/api/v1/notifications/read", { body: { ids } })
      ).catch(() => ({ data: undefined }));
      if (!data) return;
      setUnread(data.unread);
      // The rows follow the write, so a second draw of the same page
      // sends nothing and the panel agrees with the badge.
      const marked = new Set(ids);
      const readAt = new Date().toISOString();
      setItems((current) =>
        (current ?? []).map((item) => (marked.has(item.id) ? { ...item, readAt } : item)),
      );
    },
    [surface],
  );

  /**
   * Reads one page into the centre.
   *
   * `from` null is the first page, and it starts a new generation so
   * an older page in flight cannot land on top of it. `why` says who
   * asked: `open` is the reader opening the centre, and `live` is a
   * bell frame arriving while it is already open.
   */
  const loadPage = useCallback(
    async (from: string | null, why: "open" | "live" = "open") => {
      const mine = from === null ? (generation.current += 1) : generation.current;
      setBusy(true);
      setLoadFailed(false);
      if (from === null) {
        setLandingIndex(null);
        landed.current = null;
      }
      // An opened centre drops what the last read answered: a reopen
      // that fails must not leave the previous list on screen as
      // current. A live re-read keeps the rows until the answer replaces
      // them, so a reader part-way down the list is not left holding a
      // list that vanished, and a row they had focus on keeps it.
      if (from === null && why === "open") {
        setItems(null);
        setCursor(null);
      }
      const query = { query: from ? { cursor: from } : {} };
      const { data } = await (
        surface === "portal"
          ? api.GET("/api/v1/portal/notifications", { params: query })
          : api.GET("/api/v1/notifications", { params: query })
      ).catch(() => ({ data: undefined }));
      if (mine !== generation.current) return;
      setBusy(false);
      if (!data) {
        // A live re-read that fails has nothing to say: the rows on
        // screen are still the last answer, and the badge has already
        // moved. The failure copy is for a read the reader asked for.
        if (why === "open") setLoadFailed(true);
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
    [markPageRead, surface],
  );

  // One shared EventSource serves both bells and every later live
  // surface. A bell prompt carries no count or list row: both are read
  // from their ordinary routes. `open` fires again after native
  // reconnection, so every open surface re-asks the same reads.
  useEffect(
    () =>
      subscribeLiveEvents((event) => {
        if (event.kind !== "bell" && event.kind !== "open") return;
        void (async () => {
          await readCount();
          if (openNow.current) await loadPage(null, "live");
        })();
      }),
    [loadPage, readCount],
  );

  // Opening is what draws the centre, so opening is what reads it. Every
  // open re-reads: a panel opened twice in a long session must not show
  // the first open's answer. The read starts in the open handler, the
  // one place the panel is opened from. It is also the one place it is
  // closed from: a row's navigation closes through here too, so the
  // `openNow` ref the live re-read consults cannot drift from `open`.
  const onOpenChange = useCallback(
    (next: boolean) => {
      openNow.current = next;
      setOpen(next);
      if (next) void loadPage(null);
    },
    [loadPage],
  );

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
    const { data } = await (
      surface === "portal"
        ? api.POST("/api/v1/portal/notifications/read-all")
        : api.POST("/api/v1/notifications/read-all")
    ).catch(() => ({ data: undefined }));
    if (!data) return;
    setUnread(data.unread);
    const readAt = new Date().toISOString();
    setItems((current) =>
      (current ?? []).map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
    );
  }, [surface]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
        // trigger beside it. Only the foreground pair moves with the
        // surface, because only the chrome under it does.
        className={`relative flex size-6 items-center justify-center rounded-button ${TRIGGER_TONE[surface]}`}
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
        // Trailing-aligned, because the trigger sits at the trailing
        // end of the header and a panel hanging off the other side
        // would leave the screen. `p-0` drops the shared inset the
        // calendar wants (DES-048): this panel's head and rows carry
        // their own, and the head's rule has to reach both edges.
        align="end"
        className="flex max-h-(--radix-popover-content-available-height) w-(--width-panel) max-w-(--radix-popover-content-available-width) flex-col p-0"
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
              <FormattedMessage {...EMPTY_COPY[surface]} />
            </p>
          )}
          {items !== null && items.length > 0 && (
            <ol>
              {items.map((item, index) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onNavigate={() => onOpenChange(false)}
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
 * One item (DES-026's row, DES-049): a 24px medallion carrying the
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
        // Unreachable while `contract` and `request` are the only
        // entities the two mounts answer for, and the honest drawing if
        // a later record type ever reaches this panel before its route
        // does: a prompt that says what happened beats a link to
        // nowhere.
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
