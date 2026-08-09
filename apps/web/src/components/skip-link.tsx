// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Skip-to-content link (DES-011): the first focusable element on every
 * page, visually hidden until focused.
 */

import { FormattedMessage } from "react-intl";

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-button focus:bg-raised focus:px-3 focus:py-2 focus:text-md focus:text-link focus:outline-2 focus:outline-link"
    >
      <FormattedMessage id="a11y.skipToContent" defaultMessage="Skip to content" />
    </a>
  );
}
