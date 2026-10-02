// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState, type RefObject } from "react";
import { Plus, User } from "lucide-react";
import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { api } from "../lib/api";
import { CONTROL_CLASS } from "../lib/form-controls";
import { problem as readProblem } from "../lib/problem";
import { TeamRoster, type TeamPerson, type TeamRosterEntry } from "./team-roster";
import type { Applet } from "./shell/applets";
import { BusinessUserConfidentialWarning } from "./business-user-confidential-warning";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";

interface Options {
  module: "contract" | "matter";
  number: number;
  label: MessageDescriptor;
  statements: readonly TeamRosterEntry[];
  team: readonly TeamPerson[];
  businessOwnerId?: string;
  users: readonly TeamPerson[];
  frozen: boolean;
  audienceLocked: boolean;
  isConfidential: boolean;
  onTeam: (team: TeamPerson[]) => void;
}

export function useRecordTeamApplet(options: Options): Applet {
  const intl = useIntl();
  const [adding, setAdding] = useState(false);
  const addControl = useRef<HTMLButtonElement>(null);
  return {
    id: "team",
    icon: User,
    label: options.label,
    hash: `${options.module}-team`,
    accessory: () => (
      <Button
        ref={addControl}
        variant="ghost"
        size="icon"
        disabled={options.frozen || options.audienceLocked}
        aria-label={intl.formatMessage({
          id: "record.team.add",
          defaultMessage: "Add team member",
        })}
        onClick={() => setAdding(true)}
      >
        <Plus size={16} aria-hidden="true" />
      </Button>
    ),
    render: () => (
      <TeamPanel {...options} adding={adding} onAdding={setAdding} addControl={addControl} />
    ),
  };
}

function TeamPanel({
  module,
  number,
  statements,
  businessOwnerId,
  team,
  users,
  frozen,
  audienceLocked,
  isConfidential,
  onTeam,
  adding,
  onAdding,
  addControl,
}: Readonly<
  Options & {
    adding: boolean;
    onAdding: (open: boolean) => void;
    addControl: RefObject<HTMLButtonElement | null>;
  }
>) {
  const intl = useIntl();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const pressed = pendingFocus.current;
    if (!pressed || pressed.isConnected) return;
    pendingFocus.current = null;
    if (!document.activeElement || document.activeElement === document.body)
      addControl.current?.focus();
  }, [team, addControl]);
  async function remove(person: TeamPerson) {
    if (busy.current) return;
    busy.current = true;
    const pressed = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRemoving(person.id);
    setError(null);
    const result = await api
      .DELETE(
        module === "contract"
          ? "/api/v1/contracts/{number}/team/{userId}"
          : "/api/v1/matters/{number}/team/{userId}",
        {
          params: { path: { number, userId: person.id } },
        },
      )
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
        setRemoving(null);
      });
    if (!result?.data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "record.team.removeError",
            defaultMessage: "That person could not be taken off the team.",
          }),
      );
      return;
    }
    pendingFocus.current = pressed;
    onTeam(result.data.team);
  }
  // The record read sends no account type, so each person's role comes
  // from the user options, matched by id.
  const roles = new Map(users.map((person) => [person.id, person.role]));
  const withRole = (person: TeamPerson): TeamPerson => {
    const role = roles.get(person.id) ?? person.role;
    return role ? { ...person, role } : person;
  };
  return (
    <>
      <TeamRoster
        entries={[
          ...statements.map((entry) => ({ ...entry, person: withRole(entry.person) })),
          ...team.map((person) => ({
            person: withRole(person),
            onRemove:
              frozen || person.id === businessOwnerId ? undefined : () => void remove(person),
            removeDisabled: audienceLocked || removing !== null,
            removeLabel: intl.formatMessage(
              { id: "record.team.remove", defaultMessage: "Take {name} off the {module} team" },
              { name: person.displayName, module },
            ),
          })),
        ]}
      />
      {team.length === 0 && statements.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted">
          <FormattedMessage id="record.team.empty" defaultMessage="Nobody is on this team yet." />
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 pb-3 text-xs text-status-danger-fg">
          {error}
        </p>
      )}
      {adding && (
        <AddTeamDialog
          returnFocusRef={addControl}
          module={module}
          number={number}
          users={users.filter(
            (person) => !person.archived && !team.some((member) => member.id === person.id),
          )}
          disabled={frozen || audienceLocked}
          confidential={isConfidential}
          onOpenChange={onAdding}
          onAdded={onTeam}
        />
      )}
    </>
  );
}

export function AddTeamDialog({
  returnFocusRef,
  surface,
  module,
  number,
  users,
  disabled,
  confidential = false,
  onOpenChange,
  onAdded,
}: Readonly<{
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  surface?: "portal";
  module: "contract" | "matter";
  number: number;
  users: readonly TeamPerson[];
  disabled: boolean;
  /** The record is Confidential. A chosen Business User then gets a
   * warning, because joining the team opens the record to them in the
   * Portal (DD-023). */
  confidential?: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (team: TeamPerson[]) => void;
}>) {
  const intl = useIntl();
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = users.find((person) => person.id === userId);
  // The Portal sends no roles, so its list stays flat.
  const grouped = users.some((person) => person.role);
  const legal = users.filter((person) => person.role !== "business_user");
  const business = users.filter((person) => person.role === "business_user");
  const option = (person: TeamPerson) => (
    <option key={person.id} value={person.id}>
      {person.displayName}
    </option>
  );
  async function submit() {
    if (saving || disabled) return;
    if (!userId) {
      setError(
        intl.formatMessage({ id: "record.team.personMissing", defaultMessage: "Pick a person." }),
      );
      return;
    }
    setSaving(true);
    setError(null);
    const result = await api
      .POST(
        surface === "portal"
          ? `/api/v1/portal/${module}s/{number}/team`
          : module === "contract"
            ? "/api/v1/contracts/{number}/team"
            : "/api/v1/matters/{number}/team",
        {
          params: { path: { number } },
          body: { userId },
        },
      )
      .catch(() => undefined)
      .finally(() => setSaving(false));
    if (!result?.data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "record.team.addError",
            defaultMessage: "That person could not be added to the team.",
          }),
      );
      return;
    }
    onAdded(result.data.team);
    onOpenChange(false);
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusRef.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogTitle>
          <FormattedMessage id="record.team.add" defaultMessage="Add team member" />
        </DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="record-team-person">
              <FormattedMessage id="record.team.person" defaultMessage="Person" />
            </Label>
            <select
              id="record-team-person"
              className={CONTROL_CLASS}
              value={userId}
              disabled={saving || disabled}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "record.team.choose",
                  defaultMessage: "Choose a person",
                })}
              </option>
              {grouped ? (
                <>
                  {legal.length > 0 && (
                    <optgroup
                      label={intl.formatMessage({
                        id: "record.team.groupLegal",
                        defaultMessage: "Legal",
                      })}
                    >
                      {legal.map(option)}
                    </optgroup>
                  )}
                  {business.length > 0 && (
                    <optgroup
                      label={intl.formatMessage({
                        id: "record.team.groupBusiness",
                        defaultMessage: "Business Users",
                      })}
                    >
                      {business.map(option)}
                    </optgroup>
                  )}
                </>
              ) : (
                users.map(option)
              )}
            </select>
          </div>
          {confidential && chosen?.role === "business_user" && (
            <BusinessUserConfidentialWarning name={chosen.displayName} module={module} />
          )}
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={saving || disabled}>
              <FormattedMessage id="record.team.addAction" defaultMessage="Add" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
