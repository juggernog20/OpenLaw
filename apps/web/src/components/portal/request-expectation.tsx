// SPDX-License-Identifier: AGPL-3.0-only

/** INT-003: the same owner and confirmed estimate on Your requests and the Request page. */
import { FormattedMessage } from "react-intl";
import { formatFullDate } from "../../lib/format";
import type { MyRequestRow } from "../../lib/requests";

export function RequestExpectation({
  request,
}: Readonly<{ request: Pick<MyRequestRow, "owner" | "expectedBy" | "estimatePassed"> }>) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <span>
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
      <span>
        <FormattedMessage
          id="requests.expectedBackValue"
          defaultMessage="Expected back (estimate): {date}"
          values={{
            date: request.expectedBy ? (
              <time dateTime={request.expectedBy}>{formatFullDate(request.expectedBy)}</time>
            ) : (
              <FormattedMessage id="requests.estimateNotSet" defaultMessage="Not set yet" />
            ),
          }}
        />
      </span>
      {request.estimatePassed && (
        <span>
          <FormattedMessage id="requests.estimatePassed" defaultMessage="Estimate passed" />
        </span>
      )}
    </span>
  );
}
