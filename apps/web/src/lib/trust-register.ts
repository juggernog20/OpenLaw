// SPDX-License-Identifier: AGPL-3.0-only
import type { paths } from "@openlaw/api-client";
import { defineMessages, type IntlShape } from "react-intl";

export type TrustRegister =
  paths["/api/v1/entities/{id}/trust-register"]["get"]["responses"]["200"]["content"]["application/json"];
export type TrustEntry = TrustRegister["entries"][number];
export type TrustParty = TrustEntry["party"];
export type TrustRole = TrustRegister["parties"][number]["role"];
export type TrustEntryBody =
  paths["/api/v1/entities/{id}/trust-entries"]["post"]["requestBody"]["content"]["application/json"];
export const TRUST_ROLES: readonly TrustRole[] = [
  "settlor",
  "trustee",
  "protector",
  "enforcer",
  "beneficiary",
  "other",
];
export const TRUST_KINDS: readonly TrustEntry["kind"][] = [
  "appointment",
  "cessation",
  "settlement",
  "distribution",
];
export const roleMessages = defineMessages({
  settlor: { id: "entities.trust.role.settlor", defaultMessage: "Settlor" },
  trustee: { id: "entities.trust.role.trustee", defaultMessage: "Trustee" },
  protector: { id: "entities.trust.role.protector", defaultMessage: "Protector" },
  enforcer: { id: "entities.trust.role.enforcer", defaultMessage: "Enforcer" },
  beneficiary: { id: "entities.trust.role.beneficiary", defaultMessage: "Beneficiary" },
  other: { id: "entities.trust.role.other", defaultMessage: "Other" },
});
export const groupMessages = defineMessages({
  settlor: { id: "entities.trust.group.settlor", defaultMessage: "Settlors" },
  trustee: { id: "entities.trust.group.trustee", defaultMessage: "Trustees" },
  protector: { id: "entities.trust.group.protector", defaultMessage: "Protectors" },
  enforcer: { id: "entities.trust.group.enforcer", defaultMessage: "Enforcers" },
  beneficiary: { id: "entities.trust.group.beneficiary", defaultMessage: "Beneficiaries" },
  other: { id: "entities.trust.group.other", defaultMessage: "Other" },
});
export const kindMessages = defineMessages({
  appointment: { id: "entities.trust.kind.appointment", defaultMessage: "Appointment" },
  cessation: { id: "entities.trust.kind.cessation", defaultMessage: "Cessation" },
  settlement: { id: "entities.trust.kind.settlement", defaultMessage: "Settlement" },
  distribution: { id: "entities.trust.kind.distribution", defaultMessage: "Distribution" },
});
export const kindPills: Record<TrustEntry["kind"], string> = {
  appointment: "bg-status-info-bg text-status-info-fg",
  cessation: "bg-status-danger-bg text-status-danger-fg",
  settlement: "bg-status-assigned-bg text-status-assigned-fg",
  distribution: "bg-status-severe-bg text-status-severe-fg",
};
export function partyLabel(intl: IntlShape, party: TrustParty) {
  return party.restricted
    ? intl.formatMessage({ id: "entities.restricted", defaultMessage: "Restricted Entity" })
    : party.name;
}
export function knownParties(register: TrustRegister) {
  return [...new Map(register.entries.map((entry) => [entry.party.id, entry.party])).values()];
}
export function entryRole(entry: TrustEntry): TrustRole {
  return entry.kind === "settlement"
    ? "settlor"
    : entry.kind === "distribution"
      ? "beneficiary"
      : entry.role!;
}
