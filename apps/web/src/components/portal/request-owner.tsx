// SPDX-License-Identifier: AGPL-3.0-only

/** The triage owner on Your requests and the Request page. */
import { FormattedMessage } from "react-intl";
import type { MyRequestRow } from "../../lib/requests";

export function RequestOwner({ request }: Readonly<{ request: Pick<MyRequestRow, "owner"> }>) {
  return (
    <span className="text-sm text-muted">
      <FormattedMessage
        id="portal.request.owner"
        defaultMessage="Owner: {name}"
        values={{
          name: request.owner?.displayName ?? (
            <FormattedMessage id="portal.request.unassigned" defaultMessage="Not assigned yet" />
          ),
        }}
      />
    </span>
  );
}
