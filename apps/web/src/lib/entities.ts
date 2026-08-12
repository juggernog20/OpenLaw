// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry vocabulary shared by the list (/entities) and
 * the record page (/entities/:entityId): the row shape the API answers,
 * the fixed ENT-001 status enum with its pill pairs and labels, and the
 * Member+ type-picker option shape (ENT-008).
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";

/** One row of the entities API, aliased to the generated client schema
 * so a contract change surfaces as a compile error here, not as a
 * runtime surprise in a route. */
export type EntityRow =
  paths["/api/v1/entities/{id}"]["get"]["responses"]["200"]["content"]["application/json"]["entity"];

export type EntityStatus = EntityRow["status"];

/** Guards a status list literal so it can't drift from the API's enum:
 * `Exclude<EntityStatus, U[number]>` resolves to `never` only when every
 * `EntityStatus` member appears in `U`, so a status added to the API
 * schema and left out here fails to compile — as does a typo'd entry. */
function exhaustiveStatusList<U extends readonly EntityStatus[]>(
  statuses: Exclude<EntityStatus, U[number]> extends never ? U : never,
): U {
  return statuses;
}

/** The fixed ENT-001 status enum — code branches on it, so it is a
 * constant here, not a fetched list. Typed against the generated row,
 * so it can't drift from the API's enum. */
export const ENTITY_STATUSES = exhaustiveStatusList([
  "active",
  "dormant",
  "dissolved",
  "divested",
] as const);

/** One option of GET /entities/types, the Member+ picker read (ENT-008). */
export type EntityTypeOption =
  paths["/api/v1/entities/types"]["get"]["responses"]["200"]["content"]["application/json"]["entityTypes"][number];

/** EN3/EN5's status pills: active=success, dormant=warning, divested=
 * neutral (the mock's three); dissolved takes the danger pair — the
 * one terminal-negative state the mock has no row for. */
export const STATUS_PILL: Record<EntityStatus, string> = {
  active: "bg-status-success-bg text-status-success-fg",
  dormant: "bg-status-warning-bg text-status-warning-fg",
  dissolved: "bg-status-danger-bg text-status-danger-fg",
  divested: "bg-badge-count-bg text-badge-count-fg",
};

export function statusLabel(intl: IntlShape, status: EntityStatus): string {
  return intl.formatMessage(
    {
      id: "entities.statusLabel",
      defaultMessage:
        "{status, select, active {Active} dormant {Dormant} dissolved {Dissolved} " +
        "divested {Divested} other {Unknown}}",
    },
    { status },
  );
}
