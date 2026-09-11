// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessage, useIntl } from "react-intl";
import type { ContractRow, ContractTeamMember, UserOption } from "../../lib/contracts";
import { useRecordTeamApplet } from "../record-team-applet";
import type { TeamPerson, TeamRosterEntry } from "../team-roster";

export const TEAM_CARD_ID = "contract-team";
export interface TeamAppletOptions {
  contractNumber: number;
  owner: ContractRow["manager"];
  businessOwner: ContractRow["businessOwner"];
  creator?: TeamPerson | null;
  roster: readonly ContractTeamMember[];
  users: readonly UserOption[];
  frozen: boolean;
  audienceLocked: boolean;
  onRoster: (team: ContractTeamMember[]) => void;
}
export function useTeamApplet(options: TeamAppletOptions) {
  const intl = useIntl();
  const statements: TeamRosterEntry[] = [];
  if (options.owner)
    statements.push({
      person: options.owner,
      statement: intl.formatMessage({
        id: "contracts.form.legalOwner",
        defaultMessage: "Legal Owner",
      }),
    });
  if (options.businessOwner)
    statements.push({
      person: options.businessOwner,
      statement: intl.formatMessage({
        id: "contracts.form.businessOwner",
        defaultMessage: "Business Owner",
      }),
    });
  if (options.creator)
    statements.push({
      person: options.creator,
      statement: intl.formatMessage({ id: "record.team.creator", defaultMessage: "Creator" }),
    });
  return useRecordTeamApplet({
    module: "contract",
    number: options.contractNumber,
    label: defineMessage({ id: "contracts.applet.team", defaultMessage: "Contract team" }),
    statements,
    team: options.roster,
    users: options.users,
    frozen: options.frozen,
    audienceLocked: options.audienceLocked,
    onTeam: options.onRoster,
  });
}
