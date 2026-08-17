// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Application header, from the hdr frame of final-themes.pen: product
 * mark and workspace crumb on the leading edge, search in the center,
 * user menu trailing. 62px tall with 16px horizontal padding per
 * DES-007. The mock's ⚖ glyph ships as the Lucide scale icon (DES-008
 * normalization); the mock's create menu waits for the feature behind
 * it. The bell landed with the notification engine (NOT-001, M18/2) and
 * sits where the frame draws it — before the avatar in the trailing
 * cluster.
 */

import { Scale } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { NavDrawer } from "./nav-drawer";
import { NotificationBell } from "./notification-bell";
import { SearchInput } from "./search-input";
import { UserMenu, type ShellUser } from "./user-menu";

export function AppHeader({
  user,
  onSignOut,
}: Readonly<{ user: ShellUser; onSignOut: () => void }>) {
  return (
    <header className="flex h-header shrink-0 items-center justify-between gap-4 border-b border-(--chrome-header-border) bg-inverted px-4 text-on-inverted">
      <div className="flex shrink-0 items-center gap-4">
        {/* Below md the top nav is gone; the drawer's hamburger stands
            in for it here (DES-012, #46). */}
        <NavDrawer role={user.role} />
        {/* Warm gives the brand mark a dark chip; Light/Dark leave the
            chip transparent (DES-019). */}
        <span
          className="flex size-8 items-center justify-center rounded-card bg-(--chrome-brand-chip) text-(--chrome-brand-fg)"
          aria-hidden="true"
        >
          <Scale size={20} />
        </span>
        <span className="flex items-center gap-4 text-md">
          <span className="font-semibold">
            <FormattedMessage id="shell.brand" defaultMessage="openlaw" />
          </span>
          {/* The workspace crumb yields its width to search below md. */}
          <span aria-hidden="true" className="hidden text-subtle md:inline">
            /
          </span>
          <span className="hidden font-semibold md:inline">
            <FormattedMessage id="shell.workspace" defaultMessage="workspace" />
          </span>
        </span>
      </div>
      <SearchInput />
      {/* 16px between the trailing controls, as the AppHeader frame
          spaces its own cluster. */}
      <div className="flex shrink-0 items-center gap-4">
        <NotificationBell />
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
