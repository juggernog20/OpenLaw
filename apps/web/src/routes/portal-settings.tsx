// SPDX-License-Identifier: AGPL-3.0-only

/** Portal preferences cover Request updates, mentions, and shared record news (DD-023). */

import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { PageTitle } from "../components/page-title";
import {
  GROUP_COPY,
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

/** Only events the Portal can deliver. */
const PORTAL_GROUPS: readonly EventGroup[] = [
  "requester_events",
  "assigned_to_you",
  "activity_on_your_records",
];
const PORTAL_COPY: typeof GROUP_COPY = {
  ...GROUP_COPY,
  assigned_to_you: {
    label: defineMessage({ id: "portal.settings.mentions", defaultMessage: "Mentions" }),
    detail: defineMessage({
      id: "portal.settings.mentions.detail",
      defaultMessage: "Comments that mention you on your Contracts and Matters.",
    }),
  },
  activity_on_your_records: {
    ...GROUP_COPY.activity_on_your_records,
    detail: defineMessage({
      id: "portal.settings.records.detail",
      defaultMessage:
        "Shared comments and supporting Documents on your Contracts and Matters, and Contract status changes.",
    }),
  },
};

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
            defaultMessage="Choose how Legal reaches you about your Requests, Contracts, and Matters."
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
              defaultMessage="How we tell you about your work"
            />
          </h2>
          {/* One note for the card (DES-050 point 6). A note per switch
              would be two live regions over two switches. */}
          <StatusNote status={state.status} detail={state.detail} />
        </div>
        <NotificationSwitchGrid order={PORTAL_GROUPS} state={state} copy={PORTAL_COPY} />
      </section>
    </PortalShell>
  );
}
