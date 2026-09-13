// SPDX-License-Identifier: AGPL-3.0-only

/** NOT-001 and DD-023 keep the Portal notification groups and copy together. */

import { defineMessage } from "react-intl";
import { GROUP_COPY, type EventGroup } from "../notification-preferences";

/** Only events the Portal can deliver. */
export const PORTAL_GROUPS: readonly EventGroup[] = [
  "requester_events",
  "assigned_to_you",
  "activity_on_your_records",
];
export const PORTAL_COPY: typeof GROUP_COPY = {
  ...GROUP_COPY,
  assigned_to_you: {
    label: defineMessage({ id: "portal.settings.assignments", defaultMessage: "Assigned to you" }),
    detail: defineMessage({
      id: "portal.settings.assignments.detail",
      defaultMessage:
        "Contract team additions and comments that mention you on your Contracts and Matters.",
    }),
  },
  activity_on_your_records: {
    ...GROUP_COPY.activity_on_your_records,
    detail: defineMessage({
      id: "portal.settings.records.detail",
      defaultMessage:
        "Shared comments and supporting Documents on your Contracts and Matters, and Contract status changes.",
    }),
  },
};
