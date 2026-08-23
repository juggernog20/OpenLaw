// SPDX-License-Identifier: AGPL-3.0-only

/** Matter wire vocabulary shared by the list, dialog, and record hero. */
import type { paths } from "@openlaw/api-client";
import type { IntlShape } from "react-intl";

type RecordResponse =
  paths["/api/v1/matters/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
type OptionsResponse =
  paths["/api/v1/matters/options"]["get"]["responses"]["200"]["content"]["application/json"];

export type MatterRow = RecordResponse["matter"];
export type MatterField = RecordResponse["fields"][number];
export type MatterTeamMember = RecordResponse["team"][number];
export type MatterCustomFieldRefs = RecordResponse["customFieldRefs"];
export type MatterTypeOption = OptionsResponse["matterTypes"][number];
export type MatterStatusOption = OptionsResponse["matterStatuses"][number];
export type MatterUserOption = OptionsResponse["users"][number];
export type MatterSeverity = MatterRow["priority"];
export type MatterTeamRole = MatterTeamMember["role"];

export const ADDABLE_MATTER_TEAM_ROLES: readonly Exclude<MatterTeamRole, "creator">[] = [
  "member",
  "watcher",
  "contributor",
];

export const MATTER_SEVERITIES: readonly MatterSeverity[] = ["low", "medium", "high", "critical"];

export function matterPath(number: number): string {
  return `/matters/${number}`;
}

export function matterReference(intl: IntlShape, number: number): string {
  return intl.formatMessage({ id: "matters.reference", defaultMessage: "M-{number}" }, { number });
}

export function matterSeverityLabel(intl: IntlShape, value: MatterSeverity): string {
  return intl.formatMessage(
    {
      id: "matters.severity",
      defaultMessage:
        "{value, select, low {Low} medium {Medium} high {High} critical {Critical} other {Unknown}}",
    },
    { value },
  );
}

export function matterTeamRoleLabel(intl: IntlShape, role: MatterTeamRole): string {
  return intl.formatMessage(
    {
      id: "matters.team.role",
      defaultMessage:
        "{role, select, member {Member} watcher {Watcher} creator {Creator} contributor {Contributor} other {Unknown}}",
    },
    { role },
  );
}
