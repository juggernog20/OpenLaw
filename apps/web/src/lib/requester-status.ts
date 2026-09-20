// SPDX-License-Identifier: AGPL-3.0-only
import type { IntlShape } from "react-intl";
import type { RequestStatus } from "./requests";

export function requesterStatusLabel(intl: IntlShape, status: RequestStatus): string {
  return intl.formatMessage(
    {
      id: "requests.requesterStatusLabel",
      defaultMessage:
        "{status, select, new {Open} read {Read} converted {In progress} resolved {Resolved} " +
        "declined {Declined} other {Unknown}}",
    },
    { status },
  );
}
