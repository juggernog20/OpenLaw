// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-014 response types and DES-096 vocabulary for the partnership register. */

import type { paths } from "@openlaw/api-client";
import { defineMessages } from "react-intl";

export type PartnershipRegister =
  paths["/api/v1/entities/{id}/partnership-register"]["get"]["responses"]["200"]["content"]["application/json"];
export type PartnershipEntry = PartnershipRegister["entries"][number];
export type PartnershipParty = NonNullable<PartnershipEntry["party"]>;
export type PartnershipEntryBody =
  paths["/api/v1/entities/{id}/partnership-entries"]["post"]["requestBody"]["content"]["application/json"];
export const PARTNERSHIP_KINDS: readonly PartnershipEntry["kind"][] = [
  "admission",
  "commitment",
  "contribution",
  "return",
  "transfer",
  "capacity_change",
  "withdrawal",
];
export const PARTNERSHIP_BASES: readonly PartnershipRegister["basis"][] = [
  "capital",
  "units",
  "stated",
  "equal",
];
export const kindMessages = defineMessages({
  admission: { id: "entities.partnership.kind.admission", defaultMessage: "Admission" },
  commitment: { id: "entities.partnership.kind.commitment", defaultMessage: "Commitment" },
  contribution: { id: "entities.partnership.kind.contribution", defaultMessage: "Contribution" },
  return: { id: "entities.partnership.kind.return", defaultMessage: "Return" },
  transfer: { id: "entities.partnership.kind.transfer", defaultMessage: "Transfer" },
  capacity_change: {
    id: "entities.partnership.kind.capacityChange",
    defaultMessage: "Capacity change",
  },
  withdrawal: { id: "entities.partnership.kind.withdrawal", defaultMessage: "Withdrawal" },
});
export const capacityMessages = defineMessages({
  general: { id: "entities.partnership.capacity.general", defaultMessage: "General" },
  limited: { id: "entities.partnership.capacity.limited", defaultMessage: "Limited" },
  assignee: { id: "entities.partnership.capacity.assignee", defaultMessage: "Assignee" },
  ceased: { id: "entities.partnership.status.ceased", defaultMessage: "Ceased" },
});
export const basisMessages = defineMessages({
  capital: { id: "entities.partnership.basis.capital", defaultMessage: "Unreturned capital" },
  units: { id: "entities.partnership.basis.units", defaultMessage: "Units" },
  stated: { id: "entities.partnership.basis.stated", defaultMessage: "Stated percent" },
  equal: { id: "entities.partnership.basis.equal", defaultMessage: "Equal shares" },
});
export const basisNotes = defineMessages({
  capital: {
    id: "entities.partnership.note.capital",
    defaultMessage: "Ownership by unreturned capital",
  },
  units: { id: "entities.partnership.note.units", defaultMessage: "Ownership by units" },
  stated: { id: "entities.partnership.note.stated", defaultMessage: "Ownership by stated percent" },
  equal: { id: "entities.partnership.note.equal", defaultMessage: "Ownership by equal shares" },
});
export const kindPills: Record<PartnershipEntry["kind"], string> = {
  admission: "bg-status-info-bg text-status-info-fg",
  commitment: "bg-status-neutral-bg text-status-neutral-fg",
  contribution: "bg-status-assigned-bg text-status-assigned-fg",
  return: "bg-status-severe-bg text-status-severe-fg",
  transfer: "bg-status-neutral-bg text-status-neutral-fg",
  capacity_change: "bg-status-info-bg text-status-info-fg",
  withdrawal: "bg-status-danger-bg text-status-danger-fg",
};
export function knownParties(register: PartnershipRegister) {
  return [
    ...new Map(
      register.entries
        .flatMap((e) => [e.party, e.fromParty, e.toParty])
        .filter((p): p is PartnershipParty => p !== null)
        .map((p) => [p.id, p]),
    ).values(),
  ];
}
