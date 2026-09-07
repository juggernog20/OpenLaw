// SPDX-License-Identifier: AGPL-3.0-only

/** The matter record's Team applet and compound add dialog (M22/5). */
import { useRef, useState, type RefObject } from "react";
import { Plus, User } from "lucide-react";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
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
import type { Applet } from "../shell/applets";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

function isAddableMatterTeamRole(value: string): value is Exclude<MatterTeamRole, "creator"> {
  return ADDABLE_MATTER_TEAM_ROLES.some((role) => role === value);
}

interface MatterTeamOptions {
  number: number;
  manager: MatterRow["manager"];
  team: readonly MatterTeamMember[];
  users: readonly MatterUserOption[];
  frozen: boolean;
  audienceLocked: boolean;
  onTeam: (team: MatterTeamMember[]) => void;
}

export function useMatterTeamApplet(options: MatterTeamOptions): Applet {
  const intl = useIntl();
  const [adding, setAdding] = useState(false);
  const addControl = useRef<HTMLButtonElement>(null);
  return {
    id: "team",
    icon: User,
    label: defineMessage({ id: "matters.applet.team", defaultMessage: "Matter team" }),
    hash: "matter-team",
    accessory: () => (
      <Button
        ref={addControl}
        variant="ghost"
        size="icon"
        disabled={options.frozen || options.audienceLocked}
        aria-label={intl.formatMessage({
          id: "matters.team.add",
          defaultMessage: "Add team member",
        })}
        onClick={() => setAdding(true)}
      >
        <Plus size={16} aria-hidden="true" />
      </Button>
    ),
    render: () => (
      <MatterTeamPanel {...options} adding={adding} onAdding={setAdding} addControl={addControl} />
    ),
  };
}

function MatterTeamPanel({
  number,
  manager,
  team,
  users,
  frozen,
  audienceLocked,
  onTeam,
  adding,
  onAdding,
  addControl,
}: Readonly<
  MatterTeamOptions & {
    adding: boolean;
    onAdding: (open: boolean) => void;
    addControl: RefObject<HTMLButtonElement | null>;
  }
>) {
  const intl = useIntl();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(member: MatterTeamMember) {
    if (busy.current) return;
    busy.current = true;
    setRemoving(`${member.id}:${member.role}`);
    setError(null);
    const result = await api
      .DELETE("/api/v1/matters/{number}/team/{userId}/{role}", {
        params: { path: { number, userId: member.id, role: member.role } },
      })
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
        setRemoving(null);
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
    addControl.current?.focus();
  }

  return (
    <>
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
                removeDisabled: audienceLocked || removing === `${member.id}:${member.role}`,
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
          onOpenChange={onAdding}
          onAdded={onTeam}
        />
      )}
    </>
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
            <Label htmlFor="matter-team-person" required>
              <FormattedMessage id="matters.team.person" defaultMessage="Person" />
            </Label>
            <select
              id="matter-team-person"
              aria-required="true"
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
