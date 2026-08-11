// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Users (#65, #66), from the ST5 frame of settings.pen:
 * every user in one table — name, email, role, status, last active —
 * with pending invites as ordinary rows (SET-005), never
 * fire-and-forget. Inviting happens right here through a dialog, and
 * every people-facing action lives on the person's row: invite rows
 * carry resend and revoke; active rows carry the in-place role select,
 * session revocation, and the guarded archive; archived rows sit greyed
 * behind the Show-archived filter with restore. The loader is the
 * client half of SET-002's gate; the API's 403 is the real refusal.
 */

import { useState, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData } from "react-router";
import { defineMessages, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Archive, ArchiveRestore, ChevronDown, LogOut, Plus, Send, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { field } from "../lib/forms";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { UserIdentity } from "../components/user-identity";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function settingsUsersLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/users");
  if (!data) throw new Error("The user list could not be read.");
  return { users: data.users, selfId: user.id };
}

/** One row of GET /users, as the client sees it. */
interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: "administrator" | "legal_team_member" | "contributor" | "business_user";
  status: "active" | "invited" | "archived";
  lastActiveAt: string | null;
}

const INVITE_ROLES = ["legal_team_member", "contributor", "administrator"] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

/** Role edits span the whole DD-013 enum (SET-005) — a Business User can
 * be promoted to staff in place, and staff can be moved between roles. */
const ALL_ROLES = [
  "administrator",
  "legal_team_member",
  "contributor",
  "business_user",
] as const satisfies readonly UserRow["role"][];

/** One source for role wording: the visible labels and the accessible
 * names both format from here, so they can never drift apart. */
const ROLE_MESSAGES = defineMessages({
  administrator: { id: "role.administrator", defaultMessage: "Administrator" },
  legal_team_member: { id: "role.legalTeamMember", defaultMessage: "Legal team member" },
  contributor: { id: "role.contributor", defaultMessage: "Contributor" },
  business_user: { id: "role.businessUser", defaultMessage: "Business user" },
});

function RoleLabel({ role }: Readonly<{ role: UserRow["role"] }>) {
  return <FormattedMessage {...ROLE_MESSAGES[role]} />;
}

function StatusPill({ status }: Readonly<{ status: UserRow["status"] }>) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
        status === "active"
          ? "bg-status-success-bg text-status-success-fg"
          : "bg-status-neutral-bg text-status-neutral-fg",
      )}
    >
      {status === "active" && (
        <FormattedMessage id="settings.users.active" defaultMessage="Active" />
      )}
      {status === "invited" && (
        <FormattedMessage id="settings.users.invited" defaultMessage="Invited" />
      )}
      {status === "archived" && (
        <FormattedMessage id="settings.users.archived" defaultMessage="Archived" />
      )}
    </span>
  );
}

/** Mock-style stamps: "3h ago" within the week, then "Jul 28". */
function lastActiveLabel(intl: IntlShape, iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 60) {
    return intl.formatRelativeTime(-Math.max(minutes, 1), "minute", { style: "narrow" });
  }
  if (minutes < 24 * 60) {
    return intl.formatRelativeTime(-Math.floor(minutes / 60), "hour", { style: "narrow" });
  }
  if (minutes < 7 * 24 * 60) {
    return intl.formatRelativeTime(-Math.floor(minutes / (24 * 60)), "day", { style: "narrow" });
  }
  return intl.formatDate(then, {
    month: "short",
    day: "numeric",
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (user: UserRow) => void;
}>) {
  const intl = useIntl();
  const [role, setRole] = useState<InviteRole>("legal_team_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/auth/invites", {
        body: {
          email: field(fields, "inviteEmail"),
          displayName: field(fields, "inviteName"),
          role,
        },
      });
      if (data) {
        onInvited({ ...data.user, status: "invited", lastActiveAt: null });
        setRole("legal_team_member");
        onOpenChange(false);
      } else {
        // The API's own refusal (a 409 duplicate, a barred domain) is
        // more actionable than any generic line.
        setError(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.users.inviteError",
              defaultMessage: "The invite could not be sent.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.users.inviteError",
          defaultMessage: "The invite could not be sent.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="settings.users.inviteTitle" defaultMessage="Invite user" />
        </DialogTitle>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inviteName">
              <FormattedMessage id="settings.users.inviteName" defaultMessage="Display name" />
            </Label>
            <Input id="inviteName" name="inviteName" autoComplete="off" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inviteEmail">
              <FormattedMessage id="auth.field.email" defaultMessage="Email" />
            </Label>
            <Input id="inviteEmail" name="inviteEmail" type="email" autoComplete="off" required />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">
              <FormattedMessage id="settings.users.inviteRole" defaultMessage="Role" />
            </legend>
            {/* Real radios, matching the Authentication pane's mode
                choice: the fieldset/legend promises a single-choice
                group, and radios deliver its keyboard model for free. */}
            <div className="flex flex-wrap gap-4">
              {INVITE_ROLES.map((option) => (
                <label key={option} className="flex items-center gap-1.5 text-sm font-medium">
                  <input
                    type="radio"
                    name="inviteRole"
                    value={option}
                    checked={role === option}
                    onChange={() => setRole(option)}
                    className="size-3.5 accent-cta-primary"
                  />
                  <RoleLabel role={option} />
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="settings.users.inviteSubmit" defaultMessage="Send invite" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsUsersPage() {
  const { users, selfId } = useLoaderData<typeof settingsUsersLoader>();
  const intl = useIntl();

  const [rows, setRows] = useState<UserRow[]>(users);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const hasArchived = rows.some((row) => row.status === "archived");
  const visible = showArchived ? rows : rows.filter((row) => row.status !== "archived");

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(user: UserRow) {
    setRows((current) => current.map((row) => (row.id === user.id ? user : row)));
  }

  async function resend(row: UserRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/auth/invites/{userId}/resend", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      noteRow(row.id, "saved");
      return;
    }
    // An actionable refusal (an already-accepted invite) beats the
    // generic line, same as every sibling handler.
    noteRow(row.id, "error", problemDetail(error));
  }

  async function revoke(row: UserRow) {
    noteRow(row.id, "saving");
    const { error } = await api
      .DELETE("/api/v1/auth/invites/{userId}", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ error: true as const }));
    if (error) {
      noteRow(row.id, "error", problemDetail(error));
      return;
    }
    setRows((current) => current.filter((user) => user.id !== row.id));
  }

  async function changeRole(row: UserRow, role: UserRow["role"]) {
    if (role === row.role) return;
    noteRow(row.id, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/users/{userId}/role", {
        params: { path: { userId: row.id } },
        body: { role },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.user);
      noteRow(row.id, "saved");
    } else {
      // The floor's refusal ("You cannot demote the last Administrator.")
      // is the answer to "why not?" — show it, not a generic line.
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function archive(row: UserRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/users/{userId}/archive", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.user);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function unarchive(row: UserRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/users/{userId}/unarchive", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.user);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function revokeSessions(row: UserRow) {
    noteRow(row.id, "saving");
    const { error } = await api
      .POST("/api/v1/users/{userId}/revoke-sessions", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ error: true as const }));
    noteRow(row.id, error ? "error" : "saved", error ? problemDetail(error) : undefined);
  }

  /** A ghost icon action on the row; every row's actions share the
   * saving lock so a double-click cannot race two mutations. */
  function rowAction(
    row: UserRow,
    label: string,
    Icon: typeof Archive,
    onClick: (row: UserRow) => Promise<void>,
  ) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="px-1.5"
        disabled={rowStatus[row.id] === "saving"}
        aria-label={label}
        onClick={() => void onClick(row)}
      >
        <Icon size={16} aria-hidden="true" className="text-muted" />
      </Button>
    );
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({ id: "settings.section.users", defaultMessage: "Users" })}
      />
      <SettingsCard
        title={<FormattedMessage id="settings.section.users" defaultMessage="Users" />}
        // The user table spans the pane; the shared card's max width is
        // for form panes.
        className="max-w-none"
        flush
        actions={
          <div className="flex items-center gap-3">
            {/* The Archived filter (SET-005) only appears once there is
                something behind it. */}
            {hasArchived && (
              <span className="flex items-center gap-2 text-sm text-muted">
                <FormattedMessage id="settings.users.showArchived" defaultMessage="Show archived" />
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                  aria-label={intl.formatMessage({
                    id: "settings.users.showArchived",
                    defaultMessage: "Show archived",
                  })}
                />
              </span>
            )}
            <span className="text-sm text-muted">
              <FormattedMessage
                id="settings.users.count"
                defaultMessage="{count, plural, one {# user} other {# users}}"
                values={{ count: visible.length }}
              />
            </span>
            <Button size="sm" className="px-3" onClick={() => setInviteOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="settings.users.invite" defaultMessage="Invite user" />
            </Button>
          </div>
        }
      >
        {/* DES-012: the table scrolls inside the card on narrow screens. */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-default text-xs font-semibold text-muted">
                <th scope="col" className="h-9 px-4 font-semibold">
                  <FormattedMessage id="settings.users.colUser" defaultMessage="User" />
                </th>
                {/* Column widths ride the 4px spacing scale (DES-007):
                    w-50/25/30/22 are 200/100/120/88px. */}
                <th scope="col" className="h-9 w-50 px-3 font-semibold">
                  <FormattedMessage id="settings.users.colRole" defaultMessage="Role" />
                </th>
                <th scope="col" className="h-9 w-25 px-3 font-semibold">
                  <FormattedMessage id="settings.users.colStatus" defaultMessage="Status" />
                </th>
                <th scope="col" className="h-9 w-30 px-3 font-semibold">
                  <FormattedMessage
                    id="settings.users.colLastActive"
                    defaultMessage="Last active"
                  />
                </th>
                <th scope="col" className="h-9 w-22 px-3">
                  <span className="sr-only">
                    <FormattedMessage id="settings.users.colActions" defaultMessage="Actions" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="h-12 border-b border-border-muted">
                  <td className="px-4">
                    <UserIdentity
                      displayName={row.displayName}
                      email={row.email}
                      archived={row.status === "archived"}
                    />
                  </td>
                  <td className="px-3 text-sm font-medium whitespace-nowrap">
                    {row.status === "active" ? (
                      // In-place role edit (SET-005): the row IS the
                      // editor. Invite rows never edit roles, and an
                      // archived row waits for restore first.
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={rowStatus[row.id] === "saving"}
                            // Label-in-name (WCAG 2.5.3): the visible
                            // role text leads the accessible name, so a
                            // voice user's "click Administrator" lands.
                            aria-label={intl.formatMessage(
                              {
                                id: "settings.users.changeRole",
                                defaultMessage: "{role} — change the role of {email}",
                              },
                              {
                                role: intl.formatMessage(ROLE_MESSAGES[row.role]),
                                email: row.email,
                              },
                            )}
                            className="flex items-center gap-1 rounded-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:opacity-60"
                          >
                            <RoleLabel role={row.role} />
                            <ChevronDown size={12} aria-hidden="true" className="text-muted" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuRadioGroup
                            value={row.role}
                            onValueChange={(value) => {
                              // Radix hands back a plain string; narrow it
                              // against the enum instead of asserting.
                              const role = ALL_ROLES.find((option) => option === value);
                              if (role) void changeRole(row, role);
                            }}
                          >
                            {ALL_ROLES.map((role) => (
                              <DropdownMenuRadioItem key={role} value={role}>
                                <RoleLabel role={role} />
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className={cn(row.status === "archived" && "opacity-50")}>
                        <RoleLabel role={row.role} />
                      </span>
                    )}
                  </td>
                  <td className="px-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-3 text-sm whitespace-nowrap text-muted">
                    {lastActiveLabel(intl, row.lastActiveAt)}
                  </td>
                  <td className="px-3">
                    <div className="flex items-center justify-end gap-1">
                      <StatusNote status={rowStatus[row.id] ?? "idle"} detail={rowError[row.id]} />
                      {row.status === "invited" && (
                        <>
                          {rowAction(
                            row,
                            intl.formatMessage(
                              {
                                id: "settings.users.resend",
                                defaultMessage: "Resend the invite to {email}",
                              },
                              { email: row.email },
                            ),
                            Send,
                            resend,
                          )}
                          {rowAction(
                            row,
                            intl.formatMessage(
                              {
                                id: "settings.users.revoke",
                                defaultMessage: "Revoke the invite to {email}",
                              },
                              { email: row.email },
                            ),
                            Trash2,
                            revoke,
                          )}
                        </>
                      )}
                      {/* Your own row keeps the role select but no row
                          actions (the mock's rule): self-archive is
                          refused by the API, and signing yourself out
                          belongs to Profile (SET-006). */}
                      {row.status === "active" && row.id !== selfId && (
                        <>
                          {rowAction(
                            row,
                            intl.formatMessage(
                              {
                                id: "settings.users.revokeSessions",
                                defaultMessage: "Revoke all sessions of {email}",
                              },
                              { email: row.email },
                            ),
                            LogOut,
                            revokeSessions,
                          )}
                          {rowAction(
                            row,
                            intl.formatMessage(
                              {
                                id: "settings.users.archive",
                                defaultMessage: "Archive {email}",
                              },
                              { email: row.email },
                            ),
                            Archive,
                            archive,
                          )}
                        </>
                      )}
                      {row.status === "archived" &&
                        rowAction(
                          row,
                          intl.formatMessage(
                            {
                              id: "settings.users.restore",
                              defaultMessage: "Restore {email}",
                            },
                            { email: row.email },
                          ),
                          ArchiveRestore,
                          unarchive,
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(user) =>
          // A 200 re-send of an already-pending invite returns the same
          // user — never append a duplicate row for it.
          setRows((current) =>
            current.some(({ id }) => id === user.id) ? current : [...current, user],
          )
        }
      />
    </>
  );
}
