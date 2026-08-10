// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header search box, from the hC frame of final-themes.pen: a 30px
 * input on the inverted header surface with the `/` key hint on the
 * trailing edge. Registered as the `/` focus target of the keyboard
 * contract (#45) — the chip and placeholder render SEARCH_KEY so the
 * affordance cannot drift from the binding. Search results arrive
 * with the search milestone.
 */

import { useIntl } from "react-intl";
import { registerSearchTarget, SEARCH_KEY } from "../../lib/keyboard";

export function SearchInput() {
  const intl = useIntl();
  return (
    <div className="relative w-full min-w-0 max-w-120">
      <input
        type="search"
        ref={(element) => (element ? registerSearchTarget(element) : undefined)}
        aria-label={intl.formatMessage({ id: "shell.search.label", defaultMessage: "Search" })}
        placeholder={intl.formatMessage(
          {
            id: "shell.search.placeholder",
            defaultMessage: "Type {key} to search",
          },
          { key: SEARCH_KEY },
        )}
        className="h-[30px] w-full rounded-button border border-border-on-inverted bg-(--chrome-search-bg) pe-10 ps-3 text-base text-on-inverted placeholder:text-subtle"
      />
      <kbd
        aria-hidden="true"
        className="absolute end-2 top-1/2 flex h-5 w-6 -translate-y-1/2 items-center justify-center rounded-chip border border-border-on-inverted text-xs font-semibold text-subtle"
      >
        {SEARCH_KEY}
      </kbd>
    </div>
  );
}
