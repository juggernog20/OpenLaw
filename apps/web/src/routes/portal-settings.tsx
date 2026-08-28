// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The portal's notification settings (INT-001, NOT-001, M20/9) — the
 * "lightweight portal settings surface" NOT-001 promised a business
 * user, reached from the gear in the portal header.
 *
 * **It is one group and it is the whole surface.** NOT-002's group 5 is
 * the only one that says anything to a requester: the other four are
 * about contracts, records, dates, and the Inbox, none of which a
 * Business User can open (DD-013). So the pane is one row of two
 * switches, and calling it "Notification settings" rather than
 * "Settings" is the honest name for what it holds.
 *
 * **The grid is the staff pane's, unchanged** (DES-050). It draws
 * `requester_events` where the staff pane draws four groups, over the
 * same `/me/notification-preferences` pair — one preference model, one
 * table, two panes onto it. A toggle flipped here is an override on the
 * table the fan-out already reads, so the very next event honours it;
 * flipping it back to the group's own default removes the override
 * again.
 *
 * ### Recorded normalization points
 *
 * 1. **There is no frame.** `intake.pen` draws I5–I7 and none of them is
 *    this pane, or a portal header with a bell and a gear in it. The
 *    table is DES-050's, the card is the portal's own section chrome
 *    (the anatomy `portal-request.tsx` draws "What you submitted" with),
 *    and both are already ratified against frames.
 * 2. **The card is the portal column's width**, not the 720px settings
 *    card: this is the portal's chrome, and a narrower card floating in
 *    a wider column would be the only thing on the surface that did not
 *    line up with the blocks above it.
 */

import { Link, redirect, useLoaderData } from "react-router";
import { ChevronLeft } from "lucide-react";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { PageTitle } from "../components/page-title";
import {
  NotificationSwitchGrid,
  useNotificationPreferences,
  type EventGroup,
} from "../components/notification-preferences";
import { PortalShell } from "../components/portal/portal-shell";
import { StatusNote } from "../components/status-note";

export async function portalSettingsLoader() {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const { data } = await api.GET("/api/v1/me/notification-preferences");
  // A failed read must fail the pane, the staff pane's rule: drawing the
  // catalog's defaults off a network error would show somebody switches
  // that are not theirs.
  if (!data) throw new Error("The notification preferences could not be read.");
  return { user, groups: data.groups };
}

/** The one group a requester has an opinion about (NOT-001). */
const PORTAL_GROUPS: readonly EventGroup[] = ["requester_events"];

const TITLE = defineMessage({
  id: "portal.settings.title",
  defaultMessage: "Notification settings",
});

export function PortalSettingsPage() {
  const { user, groups } = useLoaderData<typeof portalSettingsLoader>();
  const intl = useIntl();
  const state = useNotificationPreferences(groups);

  const signOut = useSignOut("/portal/enter");

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(TITLE)} />
      {/* The way back is the portal home, which is where a requester's
          own list is — the Request detail's own back link, said here. */}
      <Link
        to="/portal"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
        <FormattedMessage id="portal.request.back" defaultMessage="Your requests" />
      </Link>
      <h1 className="text-xl font-semibold">
        <FormattedMessage {...TITLE} />
      </h1>
      <section
        aria-labelledby="portal-settings-heading"
        className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
      >
        {/* A `div` rather than a `header`, the my-requests block's rule:
            the portal draws one banner, and a card strip that also
            claimed the role would make "the page header" mean two
            things. */}
        <div className="flex h-section-header items-center justify-between rounded-t-card border-b border-border-default bg-section-header px-4">
          <h2 id="portal-settings-heading" className="text-base font-semibold">
            <FormattedMessage
              id="portal.settings.heading"
              defaultMessage="How we tell you about your requests"
            />
          </h2>
          {/* One note for the card, as DES-050 point 6 puts it: a note
              per switch would be two live regions over two switches. */}
          <StatusNote status={state.status} detail={state.detail} />
        </div>
        <NotificationSwitchGrid order={PORTAL_GROUPS} state={state} />
      </section>
    </PortalShell>
  );
}
