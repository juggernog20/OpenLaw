// SPDX-License-Identifier: AGPL-3.0-only

/** The matter record's working-team tray and compound add dialog (M22/5). */
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import {
  ADDABLE_MATTER_TEAM_ROLES,
  matterTeamRoleLabel,
  type MatterRow,
  type MatterTeamMember,
  type MatterTeamRole,
  type MatterUserOption,
} from "../../lib/matters";
import { problem as readProblem } from "../../lib/problem";
import { TeamRoster, type TeamRosterEntry } from "../team-roster";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

function isAddableMatterTeamRole(value: string): value is Exclude<MatterTeamRole, "creator"> {
  return ADDABLE_MATTER_TEAM_ROLES.some((role) => role === value);
}

export function MatterTeamTray({
  number,
  manager,
  team,
  users,
  frozen,
  audienceLocked,
  onTeam,
}: Readonly<{
  number: number;
  manager: MatterRow["manager"];
  team: readonly MatterTeamMember[];
  users: readonly MatterUserOption[];
  frozen: boolean;
  audienceLocked: boolean;
  onTeam: (team: MatterTeamMember[]) => void;
}>) {
  const intl = useIntl();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function remove(member: MatterTeamMember) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    const result = await api
      .DELETE("/api/v1/matters/{number}/team/{userId}/{role}", {
        params: { path: { number, userId: member.id, role: member.role } },
      })
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
      });
    if (!result?.data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "matters.team.removeError",
            defaultMessage: "That person could not be taken off the matter team.",
          }),
      );
      return;
    }
    onTeam(result.data.team);
  }

  return (
    <aside
      id="matter-team"
      aria-labelledby="matter-team-title"
      className="rounded-card border border-border-default bg-raised"
    >
      <header className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <h2 id="matter-team-title" className="font-semibold">
          <FormattedMessage id="matters.team.title" defaultMessage="Matter team" />
        </h2>
        <Button
          variant="ghost"
          size="icon"
          disabled={frozen || audienceLocked}
          aria-label={intl.formatMessage({
            id: "matters.team.add",
            defaultMessage: "Add team member",
          })}
          onClick={() => setAdding(true)}
        >
          <Plus size={16} aria-hidden="true" />
        </Button>
      </header>
      <div className="py-1">
        <TeamRoster
          entries={[
            ...(manager
              ? [
                  {
                    person: manager,
                    role: {
                      id: "manager",
                      label: intl.formatMessage({
                        id: "matters.field.manager",
                        defaultMessage: "Matter Manager",
                      }),
                    },
                  },
                ]
              : []),
            ...team.map((member): TeamRosterEntry => ({
              person: member,
              role: {
                id: member.role,
                label: matterTeamRoleLabel(intl, member.role),
                onRemove:
                  frozen || member.role === "creator" ? undefined : () => void remove(member),
                removeDisabled: audienceLocked,
                removeLabel: intl.formatMessage(
                  {
                    id: "matters.team.remove",
                    defaultMessage: "Take {name} off the matter team as {role}",
                  },
                  { name: member.displayName, role: matterTeamRoleLabel(intl, member.role) },
                ),
              },
            })),
          ]}
        />
        {!manager && team.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            <FormattedMessage
              id="matters.team.empty"
              defaultMessage="Nobody is on this matter yet."
            />
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="px-4 pb-3 text-xs text-status-danger-fg">
          {error}
        </p>
      )}
      {adding && (
        <AddMatterTeamDialog
          number={number}
          users={users}
          onOpenChange={setAdding}
          onAdded={onTeam}
        />
      )}
    </aside>
  );
}

function AddMatterTeamDialog({
  number,
  users,
  onOpenChange,
  onAdded,
}: Readonly<{
  number: number;
  users: readonly MatterUserOption[];
  onOpenChange: (open: boolean) => void;
  onAdded: (team: MatterTeamMember[]) => void;
}>) {
  const intl = useIntl();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Exclude<MatterTeamRole, "creator">>("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    if (!userId) {
      setError(
        intl.formatMessage({ id: "matters.team.personMissing", defaultMessage: "Pick a person." }),
      );
      return;
    }
    setSaving(true);
    setError(null);
    const result = await api
      .POST("/api/v1/matters/{number}/team", {
        params: { path: { number } },
        body: { userId, role },
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
    if (!result?.data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "matters.team.addError",
            defaultMessage: "That person could not be added to the matter team.",
          }),
      );
      return;
    }
    onAdded(result.data.team);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="matters.team.add" defaultMessage="Add team member" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-team-person">
              <FormattedMessage id="matters.team.person" defaultMessage="Person" />
            </Label>
            <select
              id="matter-team-person"
              className={CONTROL_CLASS}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "matters.team.pickPerson",
                  defaultMessage: "Pick a person",
                })}
              </option>
              {users.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-team-role">
              <FormattedMessage id="matters.team.roleLabel" defaultMessage="Role" />
            </Label>
            <select
              id="matter-team-role"
              className={CONTROL_CLASS}
              value={role}
              onChange={(event) => {
                if (isAddableMatterTeamRole(event.target.value)) setRole(event.target.value);
              }}
            >
              {ADDABLE_MATTER_TEAM_ROLES.map((option) => (
                <option key={option} value={option}>
                  {matterTeamRoleLabel(intl, option)}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={saving}>
              <FormattedMessage id="matters.team.addSubmit" defaultMessage="Add to team" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
