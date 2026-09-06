// SPDX-License-Identifier: AGPL-3.0-only

import { useIntl } from "react-intl";
import { MATTER_SEVERITIES, matterSeverityLabel } from "../../lib/matters";
import type { RecordFilter } from "./record-filter-bar";

export interface RecordFilterOptions {
  types: { id: string; displayName: string }[];
  statuses: { id: string; displayName: string }[];
  people: { id: string; displayName: string }[];
}

export function useRecordFilterDefinitions(
  module: "contracts" | "matters",
  options: RecordFilterOptions,
): RecordFilter[] {
  const intl = useIntl();
  const unassigned = {
    id: "unassigned",
    displayName: intl.formatMessage({
      id: "recordFilters.unassigned",
      defaultMessage: "Unassigned",
    }),
  };
  const common: RecordFilter[] = [
    {
      key: module === "contracts" ? "owner" : "manager",
      label:
        module === "contracts"
          ? intl.formatMessage({ id: "recordFilters.owner", defaultMessage: "Owner" })
          : intl.formatMessage({ id: "recordFilters.manager", defaultMessage: "Manager" }),
      kind: "choices",
      choices: [
        {
          id: "me",
          displayName: intl.formatMessage({ id: "recordFilters.me", defaultMessage: "Me" }),
        },
        unassigned,
        ...options.people,
      ],
    },
    {
      key: "status",
      label: intl.formatMessage({ id: "recordFilters.status", defaultMessage: "Status" }),
      kind: "choices",
      choices: options.statuses,
    },
    {
      key: "type",
      label: intl.formatMessage({ id: "recordFilters.type", defaultMessage: "Type" }),
      kind: "choices",
      choices: options.types,
    },
  ];
  const specific: RecordFilter[] =
    module === "contracts"
      ? [
          {
            key: "effective",
            label: intl.formatMessage({
              id: "recordFilters.effective",
              defaultMessage: "Effective date",
            }),
            kind: "date",
          },
          {
            key: "expiry",
            label: intl.formatMessage({
              id: "recordFilters.expiry",
              defaultMessage: "Expiry date",
            }),
            kind: "date",
          },
          {
            key: "includeEnded",
            label: intl.formatMessage({ id: "contracts.showEnded", defaultMessage: "Show ended" }),
            kind: "flag",
          },
        ]
      : [
          {
            key: "priority",
            label: intl.formatMessage({ id: "recordFilters.priority", defaultMessage: "Priority" }),
            kind: "choices",
            choices: MATTER_SEVERITIES.map((id) => ({
              id,
              displayName: matterSeverityLabel(intl, id),
            })),
          },
          {
            key: "risk",
            label: intl.formatMessage({ id: "recordFilters.risk", defaultMessage: "Risk" }),
            kind: "choices",
            choices: [
              ...MATTER_SEVERITIES.map((id) => ({
                id,
                displayName: matterSeverityLabel(intl, id),
              })),
              {
                ...unassigned,
                displayName: intl.formatMessage({
                  id: "recordFilters.unassessed",
                  defaultMessage: "Not assessed",
                }),
              },
            ],
          },
          {
            key: "opened",
            label: intl.formatMessage({
              id: "recordFilters.opened",
              defaultMessage: "Opened date",
            }),
            kind: "date",
          },
          {
            key: "deadline",
            label: intl.formatMessage({
              id: "recordFilters.deadline",
              defaultMessage: "Next deadline",
            }),
            kind: "date",
          },
          {
            key: "includeClosed",
            label: intl.formatMessage({ id: "matters.showClosed", defaultMessage: "Show closed" }),
            kind: "flag",
          },
        ];
  return [
    ...common,
    ...specific,
    {
      key: "includeArchived",
      label: intl.formatMessage({
        id: "recordFilters.showArchived",
        defaultMessage: "Show archived",
      }),
      kind: "flag",
    },
  ];
}
