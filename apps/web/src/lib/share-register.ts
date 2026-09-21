// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The share register vocabulary the Ownership tab reads (ENT-011): the
 * envelope GET /entities/:id/share-register answers, aliased to the
 * generated client so a contract change fails here, not in a component.
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";

export type ShareRegister =
  paths["/api/v1/entities/{id}/share-register"]["get"]["responses"]["200"]["content"]["application/json"];
export type ShareClass = ShareRegister["classes"][number];
export type RegisterRow = ShareRegister["holders"][number];
export type RegisterEntry = ShareRegister["entries"][number];
export type HolderRef = NonNullable<RegisterEntry["from"]>;
export type ShareEntryBody =
  paths["/api/v1/entities/{id}/share-entries"]["post"]["requestBody"]["content"]["application/json"];
export type ShareClassBody =
  paths["/api/v1/entities/{id}/share-classes"]["post"]["requestBody"]["content"]["application/json"];
export type ShareEntryKind = RegisterEntry["kind"];

export const SHARE_ENTRY_KINDS: readonly ShareEntryKind[] = [
  "allotment",
  "transfer",
  "buyback",
  "cancellation",
  "conversion",
];

export function entryKindLabel(intl: IntlShape, kind: ShareEntryKind): string {
  switch (kind) {
    case "allotment":
      return intl.formatMessage({
        id: "entities.register.kind.allotment",
        defaultMessage: "Allotment",
      });
    case "transfer":
      return intl.formatMessage({
        id: "entities.register.kind.transfer",
        defaultMessage: "Transfer",
      });
    case "buyback":
      return intl.formatMessage({
        id: "entities.register.kind.buyback",
        defaultMessage: "Buyback",
      });
    case "cancellation":
      return intl.formatMessage({
        id: "entities.register.kind.cancellation",
        defaultMessage: "Cancellation",
      });
    case "conversion":
      return intl.formatMessage({
        id: "entities.register.kind.conversion",
        defaultMessage: "Conversion",
      });
  }
}

/** DES-088: allotment info, transfer neutral, buyback severe, conversion assigned, cancellation danger. */
export function entryKindPillClass(kind: ShareEntryKind): string {
  switch (kind) {
    case "allotment":
      return "bg-status-info-bg text-status-info-fg";
    case "transfer":
      return "bg-status-neutral-bg text-status-neutral-fg";
    case "buyback":
      return "bg-status-severe-bg text-status-severe-fg";
    case "conversion":
      return "bg-status-assigned-bg text-status-assigned-fg";
    case "cancellation":
      return "bg-status-danger-bg text-status-danger-fg";
  }
}

/** The holder's display name, or the MTR-015 placeholder for a walled Entity. */
export function holderLabel(intl: IntlShape, holder: HolderRef | null): string {
  if (!holder) return intl.formatMessage({ id: "entities.list.value.none", defaultMessage: "—" });
  if (holder.restricted) {
    return intl.formatMessage({ id: "entities.restricted", defaultMessage: "Restricted Entity" });
  }
  return holder.name;
}

/** Every holder the register has ever named, once each, unrestricted only. */
export function knownHolders(register: ShareRegister): Extract<HolderRef, { restricted: false }>[] {
  const seen = new Map<string, Extract<HolderRef, { restricted: false }>>();
  const add = (holder: HolderRef | null) => {
    if (holder && !holder.restricted && !seen.has(holder.id)) seen.set(holder.id, holder);
  };
  for (const row of register.holders) add(row.holder);
  for (const entry of register.entries) {
    add(entry.from);
    add(entry.to);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const REGISTER_FILTER_KEYS = [
  "class",
  "kind",
  "holder",
  "effectiveFrom",
  "effectiveTo",
] as const;

/** Applies the DES-046 chips to the loaded entries, on the client. */
export function filterEntries(
  entries: readonly RegisterEntry[],
  filters: Record<string, boolean | string>,
): RegisterEntry[] {
  const pick = (key: string) =>
    typeof filters[key] === "string" && filters[key] ? String(filters[key]).split(",") : null;
  const classes = pick("class");
  const kinds = pick("kind");
  const holders = pick("holder");
  const from = typeof filters.effectiveFrom === "string" ? filters.effectiveFrom : "";
  const to = typeof filters.effectiveTo === "string" ? filters.effectiveTo : "";
  return entries.filter((entry) => {
    if (
      classes &&
      !classes.includes(entry.shareClassId) &&
      !classes.includes(entry.toShareClassId ?? "")
    )
      return false;
    if (kinds && !kinds.includes(entry.kind)) return false;
    if (holders && !holders.includes(entry.from?.id ?? "") && !holders.includes(entry.to?.id ?? ""))
      return false;
    if (from && entry.effectiveOn < from) return false;
    if (to && entry.effectiveOn > to) return false;
    return true;
  });
}
