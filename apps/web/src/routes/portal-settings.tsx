// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The portal's notification settings (INT-001, NOT-001, M20/9). This is
 * the "lightweight portal settings surface" NOT-001 promised a Business
 * User, reached from the gear in the portal header.
 *
 * One group is the whole surface. NOT-002's group 5 is the only one that
 * says anything to a requester. The other four are about contracts,
 * records, dates, and the Inbox, none of which a Business User can open
 * (DD-013). So the pane is one row of two switches, and "Notification
 * settings" rather than "Settings" is the honest name for it.
 *
 * The grid is the staff pane's, unchanged (DES-050). It draws
 * `requester_events` where the staff pane draws four groups, over the
 * same `/me/notification-preferences` GET and PATCH. One preference
 * model, one table, two panes onto it. A switch flipped here writes an
 * override on the table the fan-out reads, so the next event honours
 * it. Flipping it back to the group's default removes the override.
 *
 * Recorded normalization points:
 *
 * 1. There is no frame. `intake.pen` draws I5 to I7 and none of them is
 *    this pane, or a portal header with a bell and a gear. The table is
 *    DES-050's, the card is the portal's own section chrome, the one
 *    `portal-request.tsx` draws "What you submitted" with. Both are
 *    already ratified against frames.
 * 2. The card is the portal column's width, not the 720px settings
 *    card. A narrower card in a wider column would be the only block on
 *    the surface that did not line up with the ones above it.
 */

import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { PageTitle } from "../components/page-title";
import {
  NotificationSwitchGrid,
  useNotificationPreferences,
  type EventGroup,
} from "../components/notification-preferences";
import { PortalBackLink } from "../components/portal/back-link";
import { PortalShell } from "../components/portal/portal-shell";
import { StatusNote } from "../components/status-note";

export async function portalSettingsLoader() {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const { data } = await api.GET("/api/v1/me/notification-preferences");
  // A failed read fails the pane, the staff pane's rule. Drawing the
  // catalog's defaults after a network error would show switches that
  // are not this user's.
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
      {/* Back goes to the portal home, where the requester's own list is.
          Same target as the Request detail's back link. */}
      <PortalBackLink>
        <FormattedMessage id="portal.request.back" defaultMessage="Your requests" />
      </PortalBackLink>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage {...TITLE} />
        </h1>
        <p className="max-w-prose text-md text-muted">
          <FormattedMessage
            id="portal.settings.lead"
            defaultMessage="Choose how Legal reaches you about the requests you submit."
          />
        </p>
      </div>
      <section
        aria-labelledby="portal-settings-heading"
        className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
      >
        {/* A `div` rather than a `header`, the my-requests block's rule.
            The portal draws one banner. A card strip that also claimed
            the role would make "the page header" mean two things. */}
        <div className="flex h-section-header items-center justify-between border-b border-border-default bg-section-header px-4">
          <h2 id="portal-settings-heading" className="text-base font-semibold">
            <FormattedMessage
              id="portal.settings.heading"
              defaultMessage="How we tell you about your requests"
            />
          </h2>
          {/* One note for the card (DES-050 point 6). A note per switch
              would be two live regions over two switches. */}
          <StatusNote status={state.status} detail={state.detail} />
        </div>
        <NotificationSwitchGrid order={PORTAL_GROUPS} state={state} />
      </section>
    </PortalShell>
  );
}
