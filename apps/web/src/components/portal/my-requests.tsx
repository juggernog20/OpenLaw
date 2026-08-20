// SPDX-License-Identifier: AGPL-3.0-only

/**
 * My-requests (INT-001, #379), from the MyRequests block of I5 in
 * intake.pen: the session user's own Requests, and the way into each
 * one.
 *
 * **It answers one question and never another's.** The API scopes the
 * list to the caller (DD-013), so there is nothing to filter here and
 * no control that could widen it. Member+ staff who visit the portal
 * read their own submissions on the same block, for the same reason.
 *
 * **A converted Request is a row like any other.** Conversion links the
 * Request to what it became; it does not take the requester's window
 * away (INT-001, DD-018), so the row stays and still opens.
 *
 * **The empty state points at the type picker**, which is on the same
 * screen above it — a first visit should teach the loop rather than
 * state a fact about zero. When the Administrator has configured no
 * live types either, the pointer is dropped: there is nothing above to
 * point at.
 *
 * ### Recorded normalization points (I5 deviations accepted)
 *
 * 1. I5's row draws four facts — the reference, the summary, the status
 *    pill, and the age. The row draws five: the request type joins
 *    them, under the summary. A requester who has submitted through
 *    three different doors cannot tell an NDA request from a contract
 *    review by the summary alone, and the front door is what decides
 *    what Legal collected.
 * 2. I5 abbreviates the age ("5h ago", "Jul 28"). It renders through
 *    DES-014's `formatRelativeOrShort`, which spells the unit out
 *    ("5 hours ago") — the one date vocabulary every list in the
 *    product shares, and not a place to open a second one.
 * 3. I5 draws each row as a 44px strip with the summary on one line.
 *    The row is intrinsically tall and the summary truncates, per
 *    DES-012: a requester writes the summary, and a fixed height that
 *    fits the mock's copy is not a fact about anybody else's.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { formatRelativeOrShort } from "../../lib/format";
import { REQUEST_STATUS_PILL, requestReference, requestStatusLabel } from "../../lib/requests";
import type { MyRequestRow } from "../../lib/requests";

/** The picker's own id, so the empty state can point a first visitor at
 * it. Written rather than generated: the home draws one picker and one
 * my-requests block, and both halves have to name the same thing. */
export const REQUEST_TYPE_PICKER_ID = "portal-request-types";

export function MyRequests({
  requests,
  hasRequestTypes,
}: Readonly<{ requests: readonly MyRequestRow[]; hasRequestTypes: boolean }>) {
  const intl = useIntl();

  return (
    <section
      aria-labelledby="portal-my-requests-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      {/* A `div` rather than a `header`: the portal draws one banner,
          and a card strip that also claimed the role would make
          "the page header" mean two things. */}
      <div className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id="portal-my-requests-heading" className="text-base font-semibold">
          <FormattedMessage id="portal.myRequests.heading" defaultMessage="Your requests" />
        </h2>
        {requests.length > 0 && (
          <span className="shrink-0 text-sm text-muted">
            <FormattedMessage
              id="portal.myRequests.count"
              defaultMessage="{count, plural, one {# request} other {# requests}}"
              values={{ count: requests.length }}
            />
          </span>
        )}
      </div>
      {requests.length === 0 ? (
        <p className="p-4 text-md text-muted">
          <FormattedMessage
            id="portal.myRequests.empty"
            defaultMessage="You have not asked Legal for anything yet."
          />
          {hasRequestTypes && (
            <>
              {" "}
              <a
                href={`#${REQUEST_TYPE_PICKER_ID}`}
                className="font-medium text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
              >
                <FormattedMessage
                  id="portal.myRequests.emptyPointer"
                  defaultMessage="Pick a request type to make your first request."
                />
              </a>
            </>
          )}
        </p>
      ) : (
        <ul>
          {requests.map((row) => (
            <li key={row.id} className="border-b border-border-muted last:border-b-0">
              <Link
                to={`/portal/requests/${row.number}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-control focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
              >
                <span className="w-14 shrink-0 text-sm font-semibold text-muted">
                  {requestReference(intl, row.number)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium">{row.summary}</span>
                  <span className="truncate text-sm text-muted">{row.requestType.displayName}</span>
                </span>
                <span
                  className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[row.status]}`}
                >
                  {requestStatusLabel(intl, row.status)}
                </span>
                <time dateTime={row.createdAt} className="shrink-0 text-sm text-muted">
                  {formatRelativeOrShort(row.createdAt)}
                </time>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
