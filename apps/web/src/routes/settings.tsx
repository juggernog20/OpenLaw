// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (SET-001, #62): one guarded /settings route
 * reached from the avatar menu, a two-group left rail, and a routable
 * URL per pane. Only the Personal group renders here — rail entries
 * for unshipped panes are omitted, not disabled; the Organization
 * group arrives with its panes in later M5 tickets. Visual spec:
 * designs/settings.pen per SETTINGS-INVENTORY.md.
 */

import { Palette, User, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl, defineMessage, type MessageDescriptor } from "react-intl";
import { authClient } from "../lib/auth-client";
import { currentUser, needsSetup } from "../lib/session";
import { cn } from "../lib/utils";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";

export async function settingsLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  return { user };
}

/** The index URL forwards to the first pane that exists. */
export function settingsIndexLoader() {
  return redirect("/settings/appearance");
}

interface SettingsSection {
  id: string;
  path: string;
  icon: LucideIcon;
  label: MessageDescriptor;
}

/**
 * The Personal group, visible to every signed-in staff user. Later
 * tickets append the Organization group here, gated to Administrators
 * (SET-002's single role check).
 */
const PERSONAL_SECTIONS: SettingsSection[] = [
  {
    id: "profile",
    path: "/settings/profile",
    icon: User,
    label: defineMessage({ id: "settings.section.profile", defaultMessage: "Profile" }),
  },
  {
    id: "appearance",
    path: "/settings/appearance",
    icon: Palette,
    label: defineMessage({ id: "settings.section.appearance", defaultMessage: "Appearance" }),
  },
];

/**
 * The settings rail: 240px column from the SettingsRail frame of
 * settings.pen. Below the md container width it flattens into a
 * horizontally scrollable row so panes stay reachable on a phone
 * (DES-012: query the container, never the viewport).
 */
function SettingsRail() {
  const intl = useIntl();
  return (
    <nav
      aria-label={intl.formatMessage({
        id: "settings.rail.label",
        defaultMessage: "Settings sections",
      })}
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-default px-3 py-2 @3xl/page:w-60 @3xl/page:flex-col @3xl/page:items-stretch @3xl/page:overflow-x-visible @3xl/page:border-b-0 @3xl/page:border-r"
    >
      <h2 className="hidden px-2.5 pt-2.5 pb-1 text-xs font-semibold text-muted @3xl/page:block">
        <FormattedMessage id="settings.group.personal" defaultMessage="Personal" />
      </h2>
      {PERSONAL_SECTIONS.map((section) => (
        <NavLink
          key={section.id}
          to={section.path}
          className={({ isActive }) =>
            cn(
              // text-primary beats the global link blue: rail entries
              // read as chrome, not prose links (ST2).
              "flex items-center gap-2 rounded-button px-2.5 py-1.5 text-base whitespace-nowrap text-primary",
              isActive ? "bg-control font-semibold" : "hover:bg-control",
            )
          }
        >
          {({ isActive }) => (
            <>
              <section.icon
                size={16}
                aria-hidden="true"
                className={isActive ? "text-primary" : "text-muted"}
              />
              <FormattedMessage {...section.label} />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function SettingsLayout() {
  const { user } = useLoaderData<typeof settingsLoader>();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      flush
      subbar={
        <PageSubBar title={<FormattedMessage id="settings.title" defaultMessage="Settings" />} />
      }
    >
      <div className="flex min-h-0 w-full flex-1 flex-col @3xl/page:flex-row">
        <SettingsRail />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
