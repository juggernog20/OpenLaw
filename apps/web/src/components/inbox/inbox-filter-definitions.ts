// SPDX-License-Identifier: AGPL-3.0-only

import { useIntl } from "react-intl";
import { MATTER_SEVERITIES, matterSeverityLabel } from "../../lib/matters";
import { requestStatusLabel } from "../../lib/requests";
import type { RecordFilter } from "../table/record-filter-bar";

export function useInboxFilterDefinitions(options: {
  types: { id: string; displayName: string }[];
  people: { id: string; displayName: string }[];
}): RecordFilter[] {
  const intl = useIntl();
  return [
    {
      key: "status",
      label: intl.formatMessage({ id: "recordFilters.status", defaultMessage: "Status" }),
      kind: "choices",
      choices: (["new", "converted", "resolved", "declined"] as const).map((id) => ({
        id,
        displayName: requestStatusLabel(intl, id),
      })),
    },
    {
      key: "type",
      label: intl.formatMessage({ id: "inbox.column.type", defaultMessage: "Type" }),
      kind: "choices",
      choices: options.types,
    },
    {
      key: "urgency",
      label: intl.formatMessage({ id: "inbox.column.urgency", defaultMessage: "Urgency" }),
      kind: "choices",
      choices: MATTER_SEVERITIES.map((id) => ({ id, displayName: matterSeverityLabel(intl, id) })),
    },
    {
      key: "requester",
      label: intl.formatMessage({ id: "inbox.column.requester", defaultMessage: "Requester" }),
      kind: "choices",
      choices: [
        {
          id: "me",
          displayName: intl.formatMessage({ id: "recordFilters.me", defaultMessage: "Me" }),
        },
        ...options.people,
      ],
    },
    {
      key: "received",
      label: intl.formatMessage({ id: "inbox.filters.received", defaultMessage: "Received date" }),
      kind: "date",
    },
  ];
}
