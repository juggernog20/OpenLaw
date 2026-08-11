// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (SET-001, #62): one guarded /settings route
 * reached from the avatar menu, a two-group left rail, and a routable
 * URL per pane. The Organization group renders for Administrators only
 * (SET-002) and carries General (#63) and Users (#65, #66) plus the
 * collapsible Security group with Authentication (#64) — rail entries
 * for unshipped panes are omitted, not disabled.
 * Visual spec: designs/settings.pen per SETTINGS-INVENTORY.md.
 */

import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Palette,
  Shield,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet, redirect, useLoaderData, useLocation, useNavigate } from "react-router";
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

/** A collapsible sub-group inside a rail group (SET-001 amendment). */
interface SettingsSubgroup {
  id: string;
  label: MessageDescriptor;
  icon: LucideIcon;
  sections: SettingsSection[];
}

interface SettingsGroup {
  id: string;
  label: MessageDescriptor;
  sections: SettingsSection[];
  subgroups?: SettingsSubgroup[];
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
 * (SET-002's single role check) — absent, not disabled. Security is a
 * collapsible group per the SET-001 amendment: it holds policy about
 * how you get in, and grows (the DD-017 audit-log view lands there in
 * M9); people-facing actions live in Users (SET-005).
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
    {
      id: "users",
      path: "/settings/users",
      icon: Users,
      label: defineMessage({ id: "settings.section.users", defaultMessage: "Users" }),
    },
  ],
  subgroups: [
    {
      id: "security",
      label: defineMessage({ id: "settings.group.security", defaultMessage: "Security" }),
      icon: Shield,
      sections: [
        {
          id: "authentication",
          path: "/settings/authentication",
          icon: KeyRound,
          label: defineMessage({
            id: "settings.section.authentication",
            defaultMessage: "Authentication",
          }),
        },
      ],
    },
  ],
};

function RailEntry({ section, nested }: { section: SettingsSection; nested?: boolean }) {
  return (
    <NavLink
      to={section.path}
      className={({ isActive }) =>
        cn(
          // text-primary beats the global link blue: rail entries
          // read as chrome, not prose links (ST2).
          "flex items-center gap-2 rounded-button px-2.5 py-1.5 text-base whitespace-nowrap text-primary",
          // Sub-group entries indent under their disclosure — but only
          // in the rail column; the phone strip stays flat.
          nested && "@3xl/page:pl-8",
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
  );
}

/**
 * A collapsible rail group (SET-001 amendment: Security). Collapse is
 * conditional rendering, not CSS, so it behaves the same in the phone
 * strip — where the disclosure sits inline as one more chip. A group
 * holding the active pane starts open; the button then has the say —
 * but only on the pane where it was pressed, so navigating into the
 * group can never leave the rail hiding the pane on screen.
 */
function RailSubgroup({ subgroup }: { subgroup: SettingsSubgroup }) {
  const location = useLocation();
  const containsActive = subgroup.sections.some(
    (section) =>
      location.pathname === section.path || location.pathname.startsWith(`${section.path}/`),
  );
  const [toggled, setToggled] = useState<{ path: string; open: boolean } | null>(null);
  const open = toggled?.path === location.pathname ? toggled.open : containsActive;
  const Chevron = open ? ChevronDown : ChevronRight;
  const entriesId = `settings-rail-${subgroup.id}`;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={entriesId}
        onClick={() => setToggled({ path: location.pathname, open: !open })}
        className="flex items-center gap-2 rounded-button px-2.5 py-1.5 text-base whitespace-nowrap text-primary hover:bg-control"
      >
        <subgroup.icon size={16} aria-hidden="true" className="text-muted" />
        <FormattedMessage {...subgroup.label} />
        <Chevron size={16} aria-hidden="true" className="text-muted" />
      </button>
      {/* `contents` keeps the wrapper invisible to both the column and
          the phone strip's flat flow. */}
      <div id={entriesId} className="contents">
        {open &&
          subgroup.sections.map((section) => (
            <RailEntry key={section.id} section={section} nested />
          ))}
      </div>
    </>
  );
}

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
            <RailEntry key={section.id} section={section} />
          ))}
          {group.subgroups?.map((subgroup) => (
            <RailSubgroup key={subgroup.id} subgroup={subgroup} />
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
