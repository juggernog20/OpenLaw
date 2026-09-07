// SPDX-License-Identifier: AGPL-3.0-only

/** Displays the persisted Matter progression groups and their status choices (MTR-002 UX addenda). */

import { useIntl } from "react-intl";
import {
  MATTER_STATUS_PILL,
  MATTER_PROGRESSION_GROUPS,
  matterGroupLabel,
  matterStatusGroup,
  type MatterStatusOption,
} from "../../lib/matters";
import { StatusProgression } from "../status-progression";

export function MatterStatusProgression({
  statuses,
  statusId,
  busy,
  onPick,
}: Readonly<{
  statuses: readonly MatterStatusOption[];
  statusId: string;
  busy: boolean;
  onPick?: (statusId: string) => void;
}>) {
  const intl = useIntl();
  const ordered = MATTER_PROGRESSION_GROUPS.flatMap((group) =>
    statuses.filter((status) => matterStatusGroup(status) === group),
  );
  const current = statuses.find((status) => status.id === statusId);
  const currentGroup = current ? matterStatusGroup(current) : "open";
  return (
    <StatusProgression
      className="min-w-28"
      label={intl.formatMessage({ id: "matters.field.status", defaultMessage: "Status" })}
      currentId={currentGroup}
      steps={MATTER_PROGRESSION_GROUPS.map((group) => ({
        id: group,
        label: matterGroupLabel(intl, group),
        className: MATTER_STATUS_PILL[group === "closed" ? "closed" : "open"],
      }))}
      {...(onPick
        ? {
            move: {
              statusId,
              grouped: true,
              busy,
              onPick,
              labelForGroup: (group: string) =>
                intl.formatMessage(
                  { id: "matters.status.move", defaultMessage: "{status} — move matter" },
                  {
                    status: matterGroupLabel(
                      intl,
                      MATTER_PROGRESSION_GROUPS.find((candidate) => candidate === group) ??
                        currentGroup,
                    ),
                  },
                ),
              label: intl.formatMessage(
                { id: "matters.status.move", defaultMessage: "{status} — move matter" },
                { status: matterGroupLabel(intl, currentGroup) },
              ),
              statuses: ordered.map((status) => ({
                id: status.id,
                label: status.displayName,
                groupId: matterStatusGroup(status),
                detail: matterGroupLabel(intl, matterStatusGroup(status)),
              })),
            },
          }
        : {})}
    />
  );
}
