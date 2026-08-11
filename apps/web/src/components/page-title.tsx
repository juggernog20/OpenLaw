// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-screen document title (DES-011 commitment 7): every screen sets a
 * unique title identifying it, as "{screen} · OpenLaw". React 19 hoists
 * the <title> element into <head>, so each page mounts this once with
 * its already-localized screen name.
 */

import { useIntl } from "react-intl";

export function PageTitle({ title }: Readonly<{ title: string }>) {
  const intl = useIntl();
  return (
    <title>
      {intl.formatMessage(
        { id: "app.pageTitle", defaultMessage: "{screen} · OpenLaw" },
        { screen: title },
      )}
    </title>
  );
}
