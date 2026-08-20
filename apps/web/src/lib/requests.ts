// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request's vocabulary on the portal (INT-001, INT-002).
 *
 * One entry so far: the reference. A Request is cited the way a
 * Contract is — `contractReference` is the sibling — so the two live in
 * their own modules and read the same.
 */

import type { IntlShape } from "react-intl";

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
