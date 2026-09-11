// SPDX-License-Identifier: AGPL-3.0-only

/** The triage owner and next task deadline on both requester views. */
import { FormattedMessage } from "react-intl";
import { formatFullDate } from "../../lib/format";
import type { MyRequestRow } from "../../lib/requests";

export function RequestExpectation({
  request,
}: Readonly<{ request: Pick<MyRequestRow, "owner" | "nextDeadline" | "deadlinePassed"> }>) {
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
          id="portal.request.nextDeadline"
          defaultMessage="Next deadline: {date}"
          values={{
            date: request.nextDeadline ? (
              <time dateTime={request.nextDeadline}>{formatFullDate(request.nextDeadline)}</time>
            ) : (
              <FormattedMessage
                id="portal.request.deadlineNotSet"
                defaultMessage="No deadline scheduled"
              />
            ),
          }}
        />
      </span>
      {request.deadlinePassed && (
        <span>
          <FormattedMessage id="portal.request.deadlinePassed" defaultMessage="Deadline passed" />
        </span>
      )}
    </span>
  );
}
