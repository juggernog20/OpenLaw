// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header search box, from the hC frame of final-themes.pen: a 30px
 * input on the inverted header surface with the `/` key hint on the
 * trailing edge. The `/` shortcut itself is wired by the keyboard
 * contract (#45); search results arrive with the search milestone.
 */

import { useIntl } from "react-intl";

export function SearchInput() {
  const intl = useIntl();
  return (
    <div className="relative w-full max-w-120">
      <input
        type="search"
        aria-label={intl.formatMessage({ id: "shell.search.label", defaultMessage: "Search" })}
        placeholder={intl.formatMessage({
          id: "shell.search.placeholder",
          defaultMessage: "Type / to search",
        })}
        className="h-[30px] w-full rounded-button border border-border-on-inverted bg-inverted pe-10 ps-3 text-base text-on-inverted placeholder:text-subtle"
      />
      <kbd
        aria-hidden="true"
        className="absolute end-2 top-1/2 flex h-5 w-6 -translate-y-1/2 items-center justify-center rounded-chip border border-border-on-inverted text-xs font-semibold text-subtle"
      >
        /
      </kbd>
    </div>
  );
}
