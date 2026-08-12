// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contracts vocabulary shared by the list (/contracts) and the
 * record page (/contracts/:number): the row shape the API answers, the
 * C-### reference (CTR-003), the DES-018 severity ramp behind priority
 * and risk, the stage-keyed status pill, the CTR-004 people — the Owner
 * and the contract team's roles — and CTR-011's two sides: our Entity
 * that signs, and their Counterparties.
 *
 * The severity ramp's pill colors are not here yet: M8/1 edits priority
 * and risk as selects, and no surface renders them as pills. The ramp's
 * `Record<SeverityLevel, string>` lands with the surface that draws it.
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";

/** One contract as the API answers it, aliased to the generated client
 * schema so a contract change surfaces as a compile error here, not as
 * a runtime surprise in a route. */
type RecordResponse =
  paths["/api/v1/contracts/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
export type ContractRow = RecordResponse["contract"];

export type ContractStage = ContractRow["stage"];
export type SeverityLevel = ContractRow["priority"];

/** One `contract_team` row as the record renders it — the person and
 * the one role this row records. The same person appears once per role
 * they hold (CTR-004's compound key). */
export type ContractTeamMember = RecordResponse["team"][number];
export type ContractTeamRole = ContractTeamMember["role"];

/**
 * One party on the other side (CTR-011), as the record draws them: the
 * name, the jurisdiction that tells two same-named organizations apart,
 * and the flag saying which one the contract is listed under. The API
 * answers them primary first, so the record renders the order it is
 * given.
 */
export type ContractCounterparty = RecordResponse["counterparties"][number];

/** The live types, statuses, and people the create dialog and the
 * record's pickers read (the settings surfaces stay Administrator-only,
 * SET-002). */
type OptionsResponse =
  paths["/api/v1/contracts/options"]["get"]["responses"]["200"]["content"]["application/json"];
export type ContractTypeOption = OptionsResponse["contractTypes"][number];
export type ContractStatusOption = OptionsResponse["contractStatuses"][number];
export type UserOption = OptionsResponse["users"][number];

/**
 * One choice in the signing-entity picker (CTR-011): the id it commits
 * and the legal name it shows. It is the record's own saved shape, so
 * an entity already on a contract is offered back without translation.
 */
export type SigningEntityOption = NonNullable<ContractRow["entity"]>;

/** The M7 registry's Member+ list — the picker's source. It answers
 * full identity cards, ordered by legal name, with archived entities
 * left out; the picker narrows each row to the two columns it shows. */
type RegistryResponse =
  paths["/api/v1/entities"]["get"]["responses"]["200"]["content"]["application/json"];
export type RegistryEntity = RegistryResponse["entities"][number];

/**
 * What the picker offers: the live registry, plus the entity the record
 * already holds when the registry no longer lists it. An entity
 * archived after it signed stays on the record — dropping it would let
 * the select lie about what the contract says.
 */
export function signingEntityOptions(
  registry: readonly RegistryEntity[],
  saved: ContractRow["entity"],
): SigningEntityOption[] {
  const live = registry.map((entity) => ({ id: entity.id, legalName: entity.legalName }));
  return saved && !live.some((option) => option.id === saved.id) ? [saved, ...live] : live;
}

/** Guards a level list literal so it can't drift from the API's enum:
 * `Exclude<SeverityLevel, U[number]>` resolves to `never` only when
 * every level appears in `U` — which needs `U` inferred from the
 * literal, so the type argument is never passed by hand. A level added
 * to the API schema and left out here then fails to compile, as does a
 * typo'd entry. */
function exhaustiveSeverityList<U extends readonly SeverityLevel[]>(
  levels: Exclude<SeverityLevel, U[number]> extends never ? U : never,
): U {
  return levels;
}

/** DES-018's one ordinal severity ramp, low → critical. */
export const SEVERITY_LEVELS = exhaustiveSeverityList([
  "low",
  "medium",
  "high",
  "critical",
] as const);

/**
 * The status pill's family, keyed to the fixed stage rather than the
 * status (CTR-001: the label is renameable, the stage is not — so the
 * color follows the stage or it drifts the first time someone renames
 * a status). One nominal DES-005 family per stage, per DES-018's
 * status-pills-keep-their-families rule: nothing started yet is
 * neutral, work in progress is info, waiting on a named approver is
 * assigned, waiting on signature is warning, live is success, and over
 * takes the filled-dark register.
 */
export const STAGE_PILL: Record<ContractStage, string> = {
  draft: "bg-status-neutral-bg text-status-neutral-fg",
  review: "bg-status-info-bg text-status-info-fg",
  approval: "bg-status-assigned-bg text-status-assigned-fg",
  signature: "bg-status-warning-bg text-status-warning-fg",
  active: "bg-status-success-bg text-status-success-fg",
  ended: "bg-status-onhold-bg text-status-onhold-fg",
};

/** CTR-003's reference, as spoken and as linked: C-42. */
export function contractReference(intl: IntlShape, number: number): string {
  return intl.formatMessage(
    { id: "contracts.reference", defaultMessage: "C-{number}" },
    { number },
  );
}

export function severityLabel(intl: IntlShape, level: SeverityLevel): string {
  return intl.formatMessage(
    {
      id: "contracts.severityLabel",
      defaultMessage:
        "{level, select, low {Low} medium {Medium} high {High} critical {Critical} " +
        "other {Unknown}}",
    },
    { level },
  );
}

/** Risk is nullable on purpose: not yet assessed is not low (CTR-005). */
export function riskLabel(intl: IntlShape, level: SeverityLevel | null): string {
  return level === null
    ? intl.formatMessage({ id: "contracts.riskUnassessed", defaultMessage: "Not assessed" })
    : severityLabel(intl, level);
}

/** Guards the role list against drift from the API's enum, the same way
 * the severity ramp is guarded above. */
function exhaustiveRoleList<U extends readonly ContractTeamRole[]>(
  roles: Exclude<ContractTeamRole, U[number]> extends never ? U : never,
): U {
  return roles;
}

/** CTR-004's role enum, in the order the roster and the picker read. */
export const CONTRACT_TEAM_ROLES = exhaustiveRoleList([
  "member",
  "watcher",
  "contributor",
  "creator",
] as const);

/** What the add-member picker offers. `creator` is provenance: the
 * server writes that row at creation, and nothing adds it by hand. */
export const ADDABLE_TEAM_ROLES: readonly ContractTeamRole[] = CONTRACT_TEAM_ROLES.filter(
  (role) => role !== "creator",
);

export function teamRoleLabel(intl: IntlShape, role: ContractTeamRole): string {
  return intl.formatMessage(
    {
      id: "contracts.teamRole",
      defaultMessage:
        "{role, select, member {Member} watcher {Watcher} creator {Creator} " +
        "contributor {Contributor} other {Unknown}}",
    },
    { role },
  );
}
