// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, useRef, useState } from "react";
import { Moon, Sun, Sunset } from "lucide-react";
import { defineMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { applyPreferredTheme, THEMES, type Theme } from "../../lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const LABELS = {
  light: defineMessage({ id: "theme.light", defaultMessage: "Light" }),
  warm: defineMessage({ id: "theme.warm", defaultMessage: "Warm" }),
  dark: defineMessage({ id: "theme.dark", defaultMessage: "Dark" }),
};
const ICONS = { light: Sun, warm: Sunset, dark: Moon };

export function PortalThemeMenu({ initialTheme }: Readonly<{ initialTheme: Theme }>) {
  const intl = useIntl();
  const [theme, setTheme] = useState(initialTheme);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const Icon = ICONS[theme];
  useLayoutEffect(() => {
    applyPreferredTheme(theme);
  }, [theme]);

  async function changeTheme(next: Theme) {
    if (pending.current || next === theme) return;
    const previous = theme;
    pending.current = true;
    setSaving(true);
    setFailed(false);
    setTheme(next);
    try {
      const result = await api.PATCH("/api/v1/me/preferences", { body: { theme: next } });
      if (!result.data) throw new Error("Theme preference was not saved");
    } catch {
      setTheme(previous);
      setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const label = intl.formatMessage(
    { id: "portal.theme.choose", defaultMessage: "Theme: {theme}" },
    { theme: intl.formatMessage(LABELS[theme]) },
  );
  return (
    <div className="relative flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={saving}
            aria-label={label}
            title={label}
            className="flex size-8 items-center justify-center rounded-button text-muted hover:bg-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:opacity-50"
          >
            <Icon size={20} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (THEMES.includes(value as Theme)) void changeTheme(value as Theme);
            }}
          >
            {THEMES.map((option) => {
              const OptionIcon = ICONS[option];
              return (
                <DropdownMenuRadioItem key={option} value={option} disabled={saving}>
                  <OptionIcon size={16} aria-hidden="true" />
                  {intl.formatMessage(LABELS[option])}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <p
          role="alert"
          className="absolute end-0 top-full z-50 mt-2 w-64 rounded-card border border-border-default bg-raised p-3 text-sm text-status-danger-fg shadow-md"
        >
          {intl.formatMessage({
            id: "portal.theme.failed",
            defaultMessage: "The theme could not be saved. Please choose it again to retry.",
          })}
        </p>
      )}
    </div>
  );
}
