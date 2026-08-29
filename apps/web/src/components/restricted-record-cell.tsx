// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, type MessageDescriptor } from "react-intl";

/** MTR-015's title-free, non-navigable placeholder for a restricted record. */
export function RestrictedRecordCell({ label }: Readonly<{ label: MessageDescriptor }>) {
  return (
    <span className="text-sm text-muted">
      <FormattedMessage {...label} />
    </span>
  );
}
