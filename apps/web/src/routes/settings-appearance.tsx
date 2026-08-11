// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Appearance (#62), from the ST2 frame of settings.pen: a
 * Theme card with one preview per theme — each a miniature of its own
 * palette, so the hexes are depictions, not tokens — over a native
 * radio row. Picking a theme applies it the moment it is chosen
 * (SET-003 immediate-apply) through the shell's theme seam, which also
 * persists it via the preference endpoint.
 */

import { useIntl, FormattedMessage, defineMessage, type MessageDescriptor } from "react-intl";
import { THEMES, type Theme } from "../lib/theme";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote } from "../components/status-note";
import { useShellTheme } from "../components/shell/theme-context";

const THEME_LABELS: Record<Theme, MessageDescriptor> = {
  light: defineMessage({ id: "theme.light", defaultMessage: "Light" }),
  warm: defineMessage({ id: "theme.warm", defaultMessage: "Warm" }),
  dark: defineMessage({ id: "theme.dark", defaultMessage: "Dark" }),
};

/** Preview swatches from the ST2 mock: canvas, header strip, text skeleton. */
const PREVIEWS: Record<Theme, { canvas: string; chrome: string; line1: string; line2: string }> = {
  light: { canvas: "#FFFFFF", chrome: "#0D1117", line1: "#D0D7DE", line2: "#EFF1F3" },
  warm: { canvas: "#F7F2EA", chrome: "#2B2118", line1: "#D9CBB2", line2: "#EADFCE" },
  dark: { canvas: "#0D1117", chrome: "#010409", line1: "#30363D", line2: "#21262D" },
};

function ThemePreview({ theme, selected }: { theme: Theme; selected: boolean }) {
  const preview = PREVIEWS[theme];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[110px] flex-col overflow-hidden rounded-card border",
        selected ? "border-accent ring-1 ring-accent" : "border-border-default",
      )}
      style={{ backgroundColor: preview.canvas }}
    >
      <span className="h-[18px] shrink-0" style={{ backgroundColor: preview.chrome }} />
      <span className="flex flex-col gap-1.5 p-2.5">
        <span className="h-2 w-[90px] rounded-xs" style={{ backgroundColor: preview.line1 }} />
        <span className="h-2 w-[130px] rounded-xs" style={{ backgroundColor: preview.line2 }} />
        <span className="h-2 w-[110px] rounded-xs" style={{ backgroundColor: preview.line2 }} />
      </span>
    </span>
  );
}

export function SettingsAppearancePage() {
  const intl = useIntl();
  const { theme, changeTheme, themeStatus } = useShellTheme();

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.section.appearance",
          defaultMessage: "Appearance",
        })}
      />
      <SettingsCard
        title={<FormattedMessage id="settings.appearance.theme" defaultMessage="Theme" />}
        actions={<StatusNote status={themeStatus} />}
        flush
      >
        <fieldset className="flex flex-col gap-4 p-4">
          <legend className="sr-only">
            <FormattedMessage id="settings.appearance.theme" defaultMessage="Theme" />
          </legend>
          <div className="flex flex-col gap-3 @xl/page:flex-row">
            {THEMES.map((option) => (
              <label key={option} className="flex flex-1 cursor-pointer flex-col gap-2">
                <ThemePreview theme={option} selected={theme === option} />
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="theme"
                    value={option}
                    checked={theme === option}
                    // Immediate apply, no save ceremony (SET-003): the
                    // shell repaints this frame and persists behind it.
                    onChange={() => changeTheme(option)}
                    className="size-3.5 accent-cta-primary"
                  />
                  <span className="text-base font-medium">
                    {intl.formatMessage(THEME_LABELS[option])}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.appearance.caption"
              defaultMessage="Theme is a personal preference — it doesn't affect other users."
            />
          </p>
        </fieldset>
      </SettingsCard>
    </>
  );
}
