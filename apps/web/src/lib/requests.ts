// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request's vocabulary on the portal (INT-001, INT-002): the R-###
 * reference, the row my-requests draws, and the four-state lifecycle
 * (INT-007) as a label and a pill.
 *
 * A Request is cited the way a Contract is — `contractReference` is the
 * sibling — so the two live in their own modules and read the same. The
 * status pill follows `STATUS_PILL` in `entities.ts`: a paired
 * background and foreground from one status family, keyed by the arm,
 * so a new arm is a compile error rather than an unstyled chip.
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";

/** One row of my-requests, aliased to the generated client schema so a
 * change to what the API answers surfaces here as a compile error. */
type ListResponse =
  paths["/api/v1/portal/requests"]["get"]["responses"]["200"]["content"]["application/json"];
export type MyRequestRow = ListResponse["requests"][number];

/** INT-007's lifecycle: open, became a record, answered in the thread,
 * or turned down. */
export type RequestStatus = MyRequestRow["status"];

/** The whole Request detail read: the envelope, the fields that name
 * the collected values, and the rows those values point at. */
type DetailResponse =
  paths["/api/v1/portal/requests/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
export type MyRequestField = DetailResponse["fields"][number];
export type MyRequestFieldRefs = DetailResponse["customFieldRefs"];

/**
 * I5's and I7's status pills, on DES-005's paired status tokens: new is
 * information (the ask is open and nothing has been decided), converted
 * is success (it became real work), resolved is neutral (it is closed
 * and the outcome was not a rejection), and declined is danger — the one
 * terminal-negative arm, which the mocks have no row for.
 */
export const REQUEST_STATUS_PILL: Record<RequestStatus, string> = {
  new: "bg-status-info-bg text-status-info-fg",
  converted: "bg-status-success-bg text-status-success-fg",
  resolved: "bg-status-neutral-bg text-status-neutral-fg",
  declined: "bg-status-danger-bg text-status-danger-fg",
};

export function requestStatusLabel(intl: IntlShape, status: RequestStatus): string {
  return intl.formatMessage(
    {
      id: "requests.statusLabel",
      defaultMessage:
        "{status, select, new {New} converted {Converted} resolved {Resolved} " +
        "declined {Declined} other {Unknown}}",
    },
    { status },
  );
}

/**
 * INT-002's global reference, as spoken and as linked: R-42.
 *
 * Grouping is turned off in the skeleton: a reference is an identity,
 * not a quantity, so the thousandth Request is R-1000 and never
 * R-1,000 — nor whatever separator another locale would reach for.
 */
export function requestReference(intl: IntlShape, number: number): string {
  return intl.formatMessage(
    { id: "requests.reference", defaultMessage: "R-{number, number, ::group-off}" },
    { number },
  );
}
