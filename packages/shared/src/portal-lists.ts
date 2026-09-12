// SPDX-License-Identifier: AGPL-3.0-only

/** Portal lists sort only facts exposed by their record summaries. */
export const PORTAL_CONTRACT_SORT_KEYS = [
  "number",
  "title",
  "counterparty",
  "type",
  "stage",
  "owner",
  "effectiveDate",
  "expiryDate",
] as const;
export const PORTAL_MATTER_SORT_KEYS = ["number", "title", "type", "status", "owner"] as const;
export const PORTAL_CONTRACT_FILTER_KEYS = [
  "q",
  "stage",
  "typeId",
  "ownerId",
  "expiryFrom",
  "expiryTo",
] as const;
export const PORTAL_MATTER_FILTER_KEYS = [
  "q",
  "statusId",
  "typeId",
  "ownerId",
  "category",
] as const;
