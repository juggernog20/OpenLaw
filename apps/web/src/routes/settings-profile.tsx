// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Profile — the rail entry exists from #62 so the Personal
 * group matches SET-001; the pane itself (SET-006: name, avatar,
 * password, TOTP, sign-out-other-devices, timezone) lands with its own
 * ticket (#67). Until then this placeholder mirrors the home page's.
 */

import { useIntl, FormattedMessage } from "react-intl";
import { PageTitle } from "../components/page-title";

export function SettingsProfilePage() {
  const intl = useIntl();
  return (
    <>
      <PageTitle
        title={intl.formatMessage({ id: "settings.section.profile", defaultMessage: "Profile" })}
      />
      <p className="text-muted">
        <FormattedMessage
          id="settings.profile.placeholder"
          defaultMessage="Profile settings arrive with their own build."
        />
      </p>
    </>
  );
}
