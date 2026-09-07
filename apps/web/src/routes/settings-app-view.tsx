// SPDX-License-Identifier: AGPL-3.0-only

/** View Business Portal settings pane at /settings/app-view (SET-006 UX addendum).
 * Its loader admits Administrators and Legal Team Members. */

import { Link, redirect } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { Button } from "../components/ui/button";
import { isMemberPlus } from "../lib/roles";
import { requireUser } from "../lib/session";

export async function settingsAppViewLoader() {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/settings/profile");
  return null;
}

const TITLE = defineMessage({
  id: "settings.section.appView",
  defaultMessage: "View Business Portal",
});

export function SettingsAppViewPage() {
  const intl = useIntl();
  return (
    <>
      <PageTitle title={intl.formatMessage(TITLE)} />
      <SettingsCard title={<FormattedMessage {...TITLE} />}>
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.profile.businessView.description"
            defaultMessage="Open the intake portal as a Business User sees it: submit requests, track their progress, and talk to Legal. You’ll see your own requests, and anything you submit is real."
          />
        </p>
        <Button asChild variant="secondary" className="self-start">
          <Link to="/portal">
            <FormattedMessage
              id="settings.profile.businessView.action"
              defaultMessage="View as business user"
            />
          </Link>
        </Button>
      </SettingsCard>
    </>
  );
}
