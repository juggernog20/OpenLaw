// SPDX-License-Identifier: AGPL-3.0-only

/** The triage owner on Your requests and the Request page. */
import { UserRound } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Avatar } from "../avatar";
import type { MyRequestRow } from "../../lib/requests";

export function RequestOwner({
  request,
  profile = false,
}: Readonly<{ request: Pick<MyRequestRow, "owner">; profile?: boolean }>) {
  const name = request.owner?.displayName ?? (
    <FormattedMessage id="portal.request.unassigned" defaultMessage="Not assigned yet" />
  );

  if (profile) {
    return (
      <div className="flex w-64 max-w-full min-w-0 items-center gap-3 rounded-card border border-border-default bg-raised px-4 py-3">
        {request.owner ? (
          <Avatar name={request.owner.displayName} className="size-10" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-avatar bg-control text-muted"
          >
            <UserRound className="size-5" />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium text-muted">
            <FormattedMessage id="portal.request.legalOwner" defaultMessage="Legal Owner" />
          </span>
          <span className="text-base font-medium break-words text-primary">{name}</span>
        </div>
      </div>
    );
  }

  return (
    <span className="text-sm text-muted">
      <FormattedMessage
        id="portal.request.owner"
        defaultMessage="Legal Owner: {name}"
        values={{ name }}
      />
    </span>
  );
}
