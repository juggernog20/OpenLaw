// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header user menu: the avatar is the trigger; the menu carries the
 * account surfaces (settings, sign out). The trigger's accessible name
 * is the person's display name — the visible face is the photo or the
 * initials. Theme switching moved to the Appearance pane at /settings
 * (#62); two-factor enrolment moved to the Profile pane (SET-006, #67).
 */

import { LogOut, Settings } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { Role } from "../../lib/roles";
import type { Theme } from "../../lib/theme";
import { Avatar } from "../avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface ShellUser {
  displayName: string;
  email: string;
  /** DD-013 role; the nav draws only this role's destinations. */
  role: Role;
  theme: Theme;
  /** Avatar photo (DES-018); absent or null renders initials. */
  image?: string | null;
  /** IANA zone override; null/absent = browser-detected (DES-014). */
  timezone?: string | null;
}

export function UserMenu({
  user,
  onSignOut,
}: Readonly<{ user: ShellUser; onSignOut: () => void }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={user.displayName} className="rounded-avatar">
        <Avatar name={user.displayName} image={user.image} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block font-medium">{user.displayName}</span>
          <span className="block text-sm text-muted">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings size={16} aria-hidden="true" />
            <FormattedMessage id="shell.userMenu.settings" defaultMessage="Settings" />
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut size={16} aria-hidden="true" />
          <FormattedMessage id="auth.signOut" defaultMessage="Sign out" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
