// SPDX-License-Identifier: AGPL-3.0-only

/** Matter wire vocabulary shared by the list, dialog, and record hero. */
import type { paths } from "@openlaw/api-client";
import type { IntlShape } from "react-intl";

type RecordResponse =
  paths["/api/v1/matters/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
type OptionsResponse =
  paths["/api/v1/matters/options"]["get"]["responses"]["200"]["content"]["application/json"];
type LifecycleResponse =
  paths["/api/v1/matters/{number}/lifecycle"]["get"]["responses"]["200"]["content"]["application/json"];

export type MatterRow = RecordResponse["matter"];
export type MatterField = RecordResponse["fields"][number];
export type MatterTeamMember = RecordResponse["team"][number];
export type MatterCustomFieldRefs = RecordResponse["customFieldRefs"];
export type MatterTypeOption = OptionsResponse["matterTypes"][number];
export type MatterStatusOption = OptionsResponse["matterStatuses"][number];
export type MatterLifecycle = LifecycleResponse;
export type MatterUserOption = OptionsResponse["users"][number];
export type MatterSeverity = MatterRow["priority"];
export type MatterTeamRole = MatterTeamMember["role"];

export const ADDABLE_MATTER_TEAM_ROLES: readonly Exclude<MatterTeamRole, "creator">[] = [
  "member",
  "watcher",
  "contributor",
];

export const MATTER_SEVERITIES: readonly MatterSeverity[] = ["low", "medium", "high", "critical"];

/** Matter status colors follow the fixed Category, never the renameable label. */
export const MATTER_STATUS_PILL: Record<MatterRow["statusCategory"], string> = {
  open: "bg-status-info-bg text-status-info-fg",
  closed: "bg-status-onhold-bg text-status-onhold-fg",
};

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

export const MATTER_PROGRESSION_GROUPS = ["open", "in_progress", "waiting", "closed"] as const;
export type MatterProgressionGroup = (typeof MATTER_PROGRESSION_GROUPS)[number];

/** Status colours follow the configured progression group, including renamed statuses. */
export const MATTER_PROGRESSION_PILL: Record<MatterProgressionGroup, string> = {
  open: "bg-status-neutral-bg text-status-neutral-fg",
  in_progress: "bg-status-info-bg text-status-info-fg",
  waiting: "bg-status-warning-bg text-status-warning-fg",
  closed: "bg-status-onhold-bg text-status-onhold-fg",
};

export function matterStatusPill(
  matter: Pick<MatterRow, "statusCategory" | "statusProgressionGroup">,
): string {
  return MATTER_PROGRESSION_PILL[
    matter.statusCategory === "closed" ? "closed" : matter.statusProgressionGroup
  ];
}

export function matterGroupLabel(intl: IntlShape, group: MatterProgressionGroup): string {
  return intl.formatMessage(
    {
      id: "matters.progression.group",
      defaultMessage:
        "{group, select, open {Open} in_progress {In progress} waiting {Waiting} other {Closed}}",
    },
    { group },
  );
}

export function matterStatusGroup(status: MatterStatusOption): MatterProgressionGroup {
  return status.category === "closed" ? "closed" : status.progressionGroup;
}
