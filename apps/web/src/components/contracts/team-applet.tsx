// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The team applet (CTR-004, DES-047): who is on this contract, in the
 * activity bar's user slot, beside the work rather than in a side
 * column that stole width from every section.
 *
 * The Owner heads the roster as a statement — the Owner select on the
 * Contract card is where it changes — then one row per `contract_team`
 * role. Adding a person names two things at once, so it takes the
 * compound-edit dialog DES-017 carves out of the inline rule.
 *
 * The add control sits in the panel header, where the chat applet puts
 * its count. The roster itself is not a nested card: the panel is
 * already the surface.
 *
 * DES-028's "Manage team" fragment (`#contract-team`) opens this
 * applet. The hash is the applet's own, so the banner's link cannot
 * point at nothing.
 */

import { useRef, useState, type RefObject } from "react";
import { Plus, User, X } from "lucide-react";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import {
  ADDABLE_TEAM_ROLES,
  teamRoleLabel,
  type ContractRow,
  type ContractTeamMember,
  type ContractTeamRole,
  type UserOption,
} from "../../lib/contracts";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problemDetail } from "../../lib/messages";
import { Avatar } from "../avatar";
import type { Applet } from "../shell/applets";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

const TEAM_LABEL = defineMessage({ id: "contracts.applet.team", defaultMessage: "Team" });

/** The fragment DES-028's "Manage team" link names. RecordApplets
 * opens this applet when the hash matches, and the open panel takes
 * the same id so the fragment still has a target. */
export const TEAM_CARD_ID = "contract-team";

export interface TeamAppletOptions {
  /** CTR-003's reference — the address every contract route takes. */
  contractNumber: number;
  owner: ContractRow["manager"];
  roster: readonly ContractTeamMember[];
  users: readonly UserOption[];
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  /** The record is confidential and this viewer is none of CTR-022's
   * three actors, so the roster is not theirs to change (CTR-023).
   *
   * Inert, not absent — the same treatment DES-028 gives the flag
   * control, for the same reason: the roster is a statement of fact,
   * and who is on the contract is not the part being withheld. Only
   * the deciding is. */
  audienceLocked: boolean;
  onRoster: (team: ContractTeamMember[]) => void;
}

/**
 * The team slot, ready to hand to `RecordApplets`. The roster is
 * already on the page — it arrived with the record — so opening the
 * panel is a reveal, not a fetch.
 */
export function useTeamApplet({
  contractNumber,
  owner,
  roster,
  users,
  frozen,
  audienceLocked,
  onRoster,
}: TeamAppletOptions): Applet {
  const intl = useIntl();
  const [addOpen, setAddOpen] = useState(false);
  /** A removal unmounts the row that held focus, so focus has to be put
   * somewhere deliberate — the panel's own add control (DES-010's
   * return-focus rule, applied to a destructive row action). */
  const addControl = useRef<HTMLButtonElement>(null);

  return {
    id: "team",
    icon: User,
    label: TEAM_LABEL,
    hash: TEAM_CARD_ID,
    accessory: () => (
      <Button
        ref={addControl}
        variant="ghost"
        size="icon"
        disabled={frozen || audienceLocked}
        aria-label={intl.formatMessage({
          id: "contracts.team.add",
          defaultMessage: "Add team member",
        })}
        onClick={() => setAddOpen(true)}
      >
        <Plus size={16} aria-hidden="true" />
      </Button>
    ),
    render: () => (
      <TeamPanel
        contractNumber={contractNumber}
        owner={owner}
        roster={roster}
        users={users}
        frozen={frozen}
        audienceLocked={audienceLocked}
        addOpen={addOpen}
        addControl={addControl}
        onAddOpen={setAddOpen}
        onRoster={onRoster}
      />
    ),
  };
}

function TeamPanel({
  contractNumber,
  owner,
  roster,
  users,
  frozen,
  audienceLocked,
  addOpen,
  addControl,
  onAddOpen,
  onRoster,
}: Readonly<
  TeamAppletOptions & {
    addOpen: boolean;
    addControl: RefObject<HTMLButtonElement | null>;
    onAddOpen: (open: boolean) => void;
  }
>) {
  const intl = useIntl();
  const [error, setError] = useState<string | null>(null);
  /** One write at a time. This is a ref, not state: two clicks in one
   * tick both read the same pre-render state value and both pass, so a
   * state flag refuses nothing. */
  const inFlight = useRef(false);

  async function remove(member: ContractTeamMember) {
    if (inFlight.current) return;
    setError(null);
    inFlight.current = true;
    const { data, error: problem } = await api
      .DELETE("/api/v1/contracts/{number}/team/{userId}/{role}", {
        params: { path: { number: contractNumber, userId: member.id, role: member.role } },
      })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => {
        inFlight.current = false;
      });
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.team.removeError",
            defaultMessage: "That person could not be taken off the team.",
          }),
      );
      return;
    }
    onRoster(data.team);
    addControl.current?.focus();
  }

  return (
    <>
      <div className="flex flex-col py-1">
        {owner && (
          <PersonRow
            name={owner.displayName}
            image={owner.image}
            archived={owner.archived}
            role={intl.formatMessage({ id: "contracts.form.owner", defaultMessage: "Owner" })}
          />
        )}
        {roster.map((member) => (
          <PersonRow
            key={`${member.id}:${member.role}`}
            name={member.displayName}
            image={member.image}
            archived={member.archived}
            role={teamRoleLabel(intl, member.role)}
            // The creator is provenance — who made the record survives
            // every owner change, so it has no remove control.
            // A second click while the first is in flight is refused by
            // `remove` itself, so the control stays enabled and keeps
            // the focus its owner put on it.
            onRemove={frozen || member.role === "creator" ? undefined : () => void remove(member)}
            // Drawn and inert rather than gone: the row is a fact, and
            // only the deciding is withheld (CTR-023).
            removeDisabled={audienceLocked}
            // The role is selected inside the message, not pasted in as
            // a translated fragment — a locale that inflects the role
            // after "as" needs the raw value to work with (DES-013).
            removeLabel={intl.formatMessage(
              {
                id: "contracts.team.remove",
                defaultMessage:
                  "Take {name} off the team as {role, select, member {Member} " +
                  "watcher {Watcher} creator {Creator} contributor {Contributor} " +
                  "other {Unknown}}",
              },
              { name: member.displayName, role: member.role },
            )}
          />
        ))}
        {!owner && roster.length === 0 && (
          <p className="px-4 py-2 text-base text-muted">
            <FormattedMessage
              id="contracts.team.empty"
              defaultMessage="Nobody is on this contract yet."
            />
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-status-danger-fg">
          {error}
        </p>
      )}
      {addOpen && (
        <AddTeamMemberDialog
          contractNumber={contractNumber}
          users={users}
          onOpenChange={onAddOpen}
          onAdded={onRoster}
        />
      )}
    </>
  );
}

/** One roster row: the face, the name, and what they are on this
 * contract. One avatar treatment everywhere (DES-018). */
function PersonRow({
  name,
  image,
  archived,
  role,
  onRemove,
  removeLabel,
  removeDisabled = false,
}: Readonly<{
  name: string;
  image: string | null;
  archived: boolean;
  role: string;
  onRemove?: () => void;
  removeLabel?: string;
  /** The control is offered but refused. Absent and inert say different
   * things: absent is "this row has no remove", inert is "this remove is
   * not yours". */
  removeDisabled?: boolean;
}>) {
  return (
    <div className={`flex h-10 items-center gap-2.5 px-4 ${archived ? "opacity-50" : ""}`}>
      <Avatar name={name} image={image} className="size-6" />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-base font-medium">{name}</span>
        <span className="text-xs text-muted">{role}</span>
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="ms-auto"
          disabled={removeDisabled}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** Adding a person names two things at once — who, and in which role —
 * so it is the compound edit DES-017 carves out for a dialog. */
function AddTeamMemberDialog({
  contractNumber,
  users,
  onOpenChange,
  onAdded,
}: Readonly<{
  contractNumber: number;
  users: readonly UserOption[];
  onOpenChange: (open: boolean) => void;
  onAdded: (team: ContractTeamMember[]) => void;
}>) {
  const intl = useIntl();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ContractTeamRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    if (userId === "") {
      setError(
        intl.formatMessage({
          id: "contracts.team.personMissing",
          defaultMessage: "Pick a person.",
        }),
      );
      return;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/contracts/{number}/team", {
        params: { path: { number: contractNumber } },
        body: { userId, role },
      })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => setBusy(false));
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.team.addError",
            defaultMessage: "That person could not be added.",
          }),
      );
      return;
    }
    onAdded(data.team);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="contracts.team.add" defaultMessage="Add team member" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-person">
              <FormattedMessage id="contracts.team.person" defaultMessage="Person" />
            </Label>
            <select
              id="team-person"
              value={userId}
              className={CONTROL_CLASS}
              onChange={(event) => {
                setUserId(event.target.value);
                if (event.target.value !== "") setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({
                  id: "contracts.team.personPlaceholder",
                  defaultMessage: "Person…",
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
            <Label htmlFor="team-role">
              <FormattedMessage id="contracts.team.role" defaultMessage="Role" />
            </Label>
            <select
              id="team-role"
              value={role}
              className={CONTROL_CLASS}
              onChange={(event) => setRole(event.target.value as ContractTeamRole)}
            >
              {ADDABLE_TEAM_ROLES.map((option) => (
                <option key={option} value={option}>
                  {teamRoleLabel(intl, option)}
                </option>
              ))}
            </select>
          </div>
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
              <FormattedMessage id="contracts.team.submit" defaultMessage="Add" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
