// SPDX-License-Identifier: AGPL-3.0-only

import type { IntlShape } from "react-intl";

/**
 * The one error a fetch rejection can mean: the request never got an
 * answer. Neither fetch client catches network failures (they reject),
 * so every submit handler catches into this.
 */
export function networkError(intl: IntlShape): string {
  return intl.formatMessage({
    id: "error.network",
    defaultMessage: "The server could not be reached. Try again.",
  });
}
