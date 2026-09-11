// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessage, useIntl } from "react-intl";
import type { MatterRow, MatterTeamMember, MatterUserOption } from "../../lib/matters";
import { useRecordTeamApplet } from "../record-team-applet";
import type { TeamPerson, TeamRosterEntry } from "../team-roster";

interface MatterTeamOptions {
  number: number;
  manager: MatterRow["manager"];
  businessOwner?: TeamPerson | null;
  creator?: TeamPerson | null;
  team: readonly MatterTeamMember[];
  users: readonly MatterUserOption[];
  frozen: boolean;
  audienceLocked: boolean;
  onTeam: (team: MatterTeamMember[]) => void;
}
export function useMatterTeamApplet(options: MatterTeamOptions) {
  const intl = useIntl();
  const statements: TeamRosterEntry[] = [];
  if (options.manager)
    statements.push({
      person: options.manager,
      statement: intl.formatMessage({
        id: "matters.field.manager",
        defaultMessage: "Matter Manager",
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
    ...options,
    module: "matter",
    statements,
    label: defineMessage({ id: "matters.applet.team", defaultMessage: "Matter team" }),
  });
}
