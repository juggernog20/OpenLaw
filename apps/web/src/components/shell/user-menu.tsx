// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header user menu: the avatar is the trigger; the menu carries the
 * account surfaces (theme, two-factor enrolment, sign out). The
 * trigger's accessible name is the person's display name — the visible
 * face is only the initials.
 */

import { LogOut, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage, useIntl, defineMessage, type MessageDescriptor } from "react-intl";
import { isTheme, THEMES, type Theme } from "../../lib/theme";
import { Avatar } from "../avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface ShellUser {
  displayName: string;
  email: string;
  theme: Theme;
}

const THEME_LABELS: Record<Theme, MessageDescriptor> = {
  light: defineMessage({ id: "theme.light", defaultMessage: "Light" }),
  warm: defineMessage({ id: "theme.warm", defaultMessage: "Warm" }),
  dark: defineMessage({ id: "theme.dark", defaultMessage: "Dark" }),
};

export function UserMenu({
  user,
  theme,
  onThemeChange,
  onSignOut,
}: {
  user: ShellUser;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onSignOut: () => void;
}) {
  const intl = useIntl();
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
        <DropdownMenuLabel className="text-sm text-muted">
          <FormattedMessage id="shell.userMenu.theme" defaultMessage="Theme" />
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          // Radix hands back a plain string; the guard narrows it.
          onValueChange={(value) => {
            if (isTheme(value)) onThemeChange(value);
          }}
        >
          {THEMES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {intl.formatMessage(THEME_LABELS[option])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
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
