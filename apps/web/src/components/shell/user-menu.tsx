// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header user menu: the avatar is the trigger; the menu carries the
 * account surfaces (settings, two-factor enrolment, sign out). The
 * trigger's accessible name is the person's display name — the visible
 * face is only the initials. Theme switching moved to the Appearance
 * pane at /settings (#62).
 */

import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
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
  theme: Theme;
}

export function UserMenu({ user, onSignOut }: { user: ShellUser; onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={user.displayName} className="rounded-avatar">
        <Avatar name={user.displayName} />
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
        <DropdownMenuItem asChild>
          <Link to="/auth/two-factor/enroll">
            <ShieldCheck size={16} aria-hidden="true" />
            <FormattedMessage
              id="shell.userMenu.twoFactor"
              defaultMessage="Two-factor authentication"
            />
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
