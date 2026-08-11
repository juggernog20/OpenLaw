// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (SET-001, #62): one guarded /settings route
 * reached from the avatar menu, a two-group left rail, and a routable
 * URL per pane. The Organization group renders for Administrators only
 * (SET-002) and carries General (#63) so far — rail entries for
 * unshipped panes are omitted, not disabled; Users and Security arrive
 * with their own M5 tickets. Visual spec: designs/settings.pen per
 * SETTINGS-INVENTORY.md.
 */

import { Building2, Palette, User, type LucideIcon } from "lucide-react";
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

interface SettingsGroup {
  id: string;
  label: MessageDescriptor;
  sections: SettingsSection[];
}

/** The Personal group, visible to every signed-in user. */
const PERSONAL_GROUP: SettingsGroup = {
  id: "personal",
  label: defineMessage({ id: "settings.group.personal", defaultMessage: "Personal" }),
  sections: [
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
  ],
};

/**
 * The Organization group, hidden entirely from non-Administrators
 * (SET-002's single role check) — absent, not disabled. Users and the
 * Security group append here with their own M5 tickets.
 */
const ORGANIZATION_GROUP: SettingsGroup = {
  id: "organization",
  label: defineMessage({ id: "settings.group.organization", defaultMessage: "Organization" }),
  sections: [
    {
      id: "general",
      path: "/settings/general",
      icon: Building2,
      label: defineMessage({ id: "settings.section.general", defaultMessage: "General" }),
    },
  ],
};

/**
 * The settings rail: 240px column from the SettingsRail frame of
 * settings.pen. Below the md container width it flattens into a
 * horizontally scrollable row so panes stay reachable on a phone
 * (DES-012: query the container, never the viewport).
 */
function SettingsRail({ isAdministrator }: { isAdministrator: boolean }) {
  const intl = useIntl();
  const groups = isAdministrator ? [PERSONAL_GROUP, ORGANIZATION_GROUP] : [PERSONAL_GROUP];
  return (
    <nav
      aria-label={intl.formatMessage({
        id: "settings.rail.label",
        defaultMessage: "Settings sections",
      })}
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-default px-3 py-2 @3xl/page:w-60 @3xl/page:flex-col @3xl/page:items-stretch @3xl/page:overflow-x-visible @3xl/page:border-b-0 @3xl/page:border-r"
    >
      {groups.map((group) => (
        // Fragment-per-group keeps the phone row flat: labels hide, and
        // every entry flows into the one scrollable strip.
        <div
          key={group.id}
          className="contents @3xl/page:flex @3xl/page:flex-col @3xl/page:gap-0.5"
        >
          <h2 className="hidden px-2.5 pt-2.5 pb-1 text-xs font-semibold text-muted @3xl/page:block">
            <FormattedMessage {...group.label} />
          </h2>
          {group.sections.map((section) => (
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
        </div>
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
        <SettingsRail isAdministrator={user.role === "administrator"} />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
