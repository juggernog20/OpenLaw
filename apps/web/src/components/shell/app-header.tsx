// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Application header, from the hdr frame of final-themes.pen: product
 * mark and workspace crumb on the leading edge, search in the center,
 * user menu trailing. 62px tall with 16px horizontal padding per
 * DES-007. The mock's ⚖ glyph ships as the Lucide scale icon (DES-008
 * normalization); the mock's bell and create menu wait for the
 * features behind them.
 */

import { Scale } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { SearchInput } from "./search-input";
import { UserMenu, type ShellUser } from "./user-menu";

export function AppHeader({ user, onSignOut }: { user: ShellUser; onSignOut: () => void }) {
  return (
    <header className="flex h-(--height-header) shrink-0 items-center justify-between gap-4 bg-inverted px-4 text-on-inverted">
      <div className="flex shrink-0 items-center gap-4">
        <span className="flex size-8 items-center justify-center" aria-hidden="true">
          <Scale size={20} />
        </span>
        <span className="flex items-center gap-4 text-md">
          <span className="font-semibold">
            <FormattedMessage id="shell.brand" defaultMessage="openlaw" />
          </span>
          <span aria-hidden="true" className="text-subtle">
            /
          </span>
          <span className="font-semibold">
            <FormattedMessage id="shell.workspace" defaultMessage="workspace" />
          </span>
        </span>
      </div>
      <SearchInput />
      <div className="flex shrink-0 items-center">
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
