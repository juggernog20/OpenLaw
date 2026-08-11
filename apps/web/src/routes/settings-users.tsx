// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Users (#65), from the ST5 frame of settings.pen: every
 * user in one table — name, email, role, status, last active — with
 * pending invites as ordinary rows (SET-005), never fire-and-forget.
 * Inviting happens right here through a dialog (the wizard is no longer
 * the only door), and an invite row carries resend and revoke. Role
 * edits, archival, and session revocation follow with #66. The loader
 * is the client half of SET-002's gate; the API's 403 is the real
 * refusal.
 */

import { useState, type FormEvent } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Plus, Send, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { currentUser, needsSetup } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsUsersLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/users");
  if (!data) throw new Error("The user list could not be read.");
  return { users: data.users };
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

function RoleLabel({ role }: { role: UserRow["role"] }) {
  switch (role) {
    case "administrator":
      return <FormattedMessage id="role.administrator" defaultMessage="Administrator" />;
    case "legal_team_member":
      return <FormattedMessage id="role.legalTeamMember" defaultMessage="Legal team member" />;
    case "contributor":
      return <FormattedMessage id="role.contributor" defaultMessage="Contributor" />;
    case "business_user":
      return <FormattedMessage id="role.businessUser" defaultMessage="Business user" />;
  }
}

function StatusPill({ status }: { status: UserRow["status"] }) {
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

function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (user: UserRow) => void;
}) {
  const intl = useIntl();
  const [role, setRole] = useState<InviteRole>("legal_team_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/auth/invites", {
        body: {
          email: String(fields.get("inviteEmail") ?? ""),
          displayName: String(fields.get("inviteName") ?? ""),
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
          typeof problem?.detail === "string"
            ? problem.detail
            : intl.formatMessage({
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
            <div className="flex flex-wrap gap-2">
              {INVITE_ROLES.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={role === option ? "primary" : "secondary"}
                  aria-pressed={role === option}
                  onClick={() => setRole(option)}
                >
                  <RoleLabel role={option} />
                </Button>
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
              <FormattedMessage id="settings.users.inviteCancel" defaultMessage="Cancel" />
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
  const { users } = useLoaderData<typeof settingsUsersLoader>();
  const intl = useIntl();

  const [rows, setRows] = useState<UserRow[]>(users);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [inviteOpen, setInviteOpen] = useState(false);

  function noteRow(id: string, status: FieldStatus) {
    setRowStatus((s) => ({ ...s, [id]: status }));
  }

  async function resend(row: UserRow) {
    noteRow(row.id, "saving");
    const { data } = await api
      .POST("/api/v1/auth/invites/{userId}/resend", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ data: null }));
    noteRow(row.id, data ? "saved" : "error");
  }

  async function revoke(row: UserRow) {
    noteRow(row.id, "saving");
    const { error } = await api
      .DELETE("/api/v1/auth/invites/{userId}", {
        params: { path: { userId: row.id } },
      })
      .catch(() => ({ error: true as const }));
    if (error) {
      noteRow(row.id, "error");
      return;
    }
    setRows((current) => current.filter((user) => user.id !== row.id));
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({ id: "settings.section.users", defaultMessage: "Users" })}
      />
      <Card className="w-full">
        <div className="flex h-[38px] items-center justify-between rounded-t-card border-b border-border-default bg-section-header px-4">
          <h2 className="text-base font-semibold">
            <FormattedMessage id="settings.section.users" defaultMessage="Users" />
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              <FormattedMessage
                id="settings.users.count"
                defaultMessage="{count, plural, one {# user} other {# users}}"
                values={{ count: rows.length }}
              />
            </span>
            <Button size="sm" className="px-3" onClick={() => setInviteOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="settings.users.invite" defaultMessage="Invite user" />
            </Button>
          </div>
        </div>
        {/* DES-012: the table scrolls inside the card on narrow screens. */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-default text-xs font-semibold text-muted">
                <th scope="col" className="h-9 px-4 font-semibold">
                  <FormattedMessage id="settings.users.colUser" defaultMessage="User" />
                </th>
                <th scope="col" className="h-9 w-[200px] px-3 font-semibold">
                  <FormattedMessage id="settings.users.colRole" defaultMessage="Role" />
                </th>
                <th scope="col" className="h-9 w-[100px] px-3 font-semibold">
                  <FormattedMessage id="settings.users.colStatus" defaultMessage="Status" />
                </th>
                <th scope="col" className="h-9 w-[120px] px-3 font-semibold">
                  <FormattedMessage
                    id="settings.users.colLastActive"
                    defaultMessage="Last active"
                  />
                </th>
                <th scope="col" className="h-9 w-[88px] px-3">
                  <span className="sr-only">
                    <FormattedMessage id="settings.users.colActions" defaultMessage="Actions" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="h-12 border-b border-border-muted">
                  <td className="px-4">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-control text-xs font-semibold text-primary"
                      >
                        {initialsOf(row.displayName)}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-base font-medium whitespace-nowrap">
                          {row.displayName}
                        </span>
                        <span className="text-sm whitespace-nowrap text-muted">{row.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 text-sm font-medium whitespace-nowrap">
                    <RoleLabel role={row.role} />
                  </td>
                  <td className="px-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-3 text-sm whitespace-nowrap text-muted">
                    {lastActiveLabel(intl, row.lastActiveAt)}
                  </td>
                  <td className="px-3">
                    {row.status === "invited" && (
                      <div className="flex items-center justify-end gap-1">
                        <StatusNote status={rowStatus[row.id] ?? "idle"} />
                        {/* Both actions pause while either request is in
                            flight — a double-click must not race a resend
                            against a revoke of the same invite. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1.5"
                          disabled={rowStatus[row.id] === "saving"}
                          aria-label={intl.formatMessage(
                            {
                              id: "settings.users.resend",
                              defaultMessage: "Resend the invite to {email}",
                            },
                            { email: row.email },
                          )}
                          onClick={() => void resend(row)}
                        >
                          <Send size={16} aria-hidden="true" className="text-muted" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1.5"
                          disabled={rowStatus[row.id] === "saving"}
                          aria-label={intl.formatMessage(
                            {
                              id: "settings.users.revoke",
                              defaultMessage: "Revoke the invite to {email}",
                            },
                            { email: row.email },
                          )}
                          onClick={() => void revoke(row)}
                        >
                          <Trash2 size={16} aria-hidden="true" className="text-muted" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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
