// SPDX-License-Identifier: AGPL-3.0-only
import type { TrustRole, TrustEntryKind } from "@openlaw/db";

export interface TrustEntry {
  id: string;
  entryNo: number;
  kind: TrustEntryKind;
  effectiveOn: string;
  partyId: string;
  role: TrustRole | null;
  roleLabel: string | null;
  interest: string | null;
  amount: number | null;
  currency: string | null;
  property: string | null;
}
export interface TrustRoleInterval {
  partyId: string;
  role: TrustRole;
  roleLabel: string | null;
  interest: string | null;
  since: string;
  until: string | null;
  open: boolean;
}
export interface TrustViolation {
  code:
    "duplicate-appointment" | "role-not-held" | "not-beneficiary" | "class-role" | "fund-overflow";
  entryId: string;
  entryNo: number;
  detail: string;
}
export const TRUST_ROLE_ORDER: readonly TrustRole[] = [
  "settlor",
  "trustee",
  "protector",
  "enforcer",
  "beneficiary",
  "other",
];

/** Replays dated facts only; callers choose the date and supply all parties. */
export function replayTrustRegister(
  input: {
    parties: readonly { id: string; kind: "entity" | "individual" | "class" }[];
    entries: readonly TrustEntry[];
  },
  asOf: string,
) {
  const roles: TrustRoleInterval[] = [];
  const fund = new Map<
    string,
    { currency: string; settled: number; distributed: number; balance: number }
  >();
  const parties = new Map(input.parties.map((p) => [p.id, p]));
  let violation: TrustViolation | null = null;
  const fail = (
    entry: TrustEntry,
    code: TrustViolation["code"],
    detail: string,
  ): TrustViolation => {
    return {
      code,
      entryId: entry.id,
      entryNo: entry.entryNo,
      detail: `Entry ${entry.entryNo} (${entry.effectiveOn}): ${detail}`,
    };
  };
  for (const entry of [...input.entries].sort(
    (a, b) => a.effectiveOn.localeCompare(b.effectiveOn) || a.entryNo - b.entryNo,
  )) {
    if (entry.effectiveOn > asOf) break;
    const role =
      entry.kind === "settlement"
        ? "settlor"
        : entry.kind === "distribution"
          ? "beneficiary"
          : entry.role!;
    const label = role === "other" ? entry.roleLabel : null;
    const current = roles.find(
      (r) => r.partyId === entry.partyId && r.role === role && r.roleLabel === label && r.open,
    );
    if (parties.get(entry.partyId)?.kind === "class" && role !== "beneficiary") {
      violation = fail(entry, "class-role", "A class may hold the beneficiary role only.");
      break;
    }
    if (entry.kind === "appointment" && current) {
      violation = fail(entry, "duplicate-appointment", "The party already holds this role.");
      break;
    }
    if (entry.kind === "cessation") {
      if (!current) {
        violation = fail(entry, "role-not-held", "The party does not hold this role.");
        break;
      }
      current.until = entry.effectiveOn;
      current.open = false;
    } else if (entry.kind === "distribution") {
      if (!current) {
        violation = fail(entry, "not-beneficiary", "The party is not a beneficiary on this date.");
        break;
      }
    } else if (!current) {
      roles.push({
        partyId: entry.partyId,
        role,
        roleLabel: label,
        interest: entry.interest,
        since: entry.effectiveOn,
        until: null,
        open: true,
      });
    }
    if (
      (entry.kind === "settlement" || entry.kind === "distribution") &&
      entry.amount !== null &&
      entry.currency !== null
    ) {
      const total = fund.get(entry.currency) ?? {
        currency: entry.currency,
        settled: 0,
        distributed: 0,
        balance: 0,
      };
      const key = entry.kind === "settlement" ? "settled" : "distributed";
      if (!Number.isSafeInteger(total[key] + entry.amount)) {
        violation = fail(
          entry,
          "fund-overflow",
          "The fund total exceeds the supported minor-unit range.",
        );
        break;
      }
      total[key] += entry.amount;
      total.balance = total.settled - total.distributed;
      fund.set(entry.currency, total);
    }
  }
  const totals = [...fund.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  return {
    roles: roles.sort(
      (a, b) =>
        TRUST_ROLE_ORDER.indexOf(a.role) - TRUST_ROLE_ORDER.indexOf(b.role) ||
        a.partyId.localeCompare(b.partyId) ||
        a.since.localeCompare(b.since),
    ),
    fund: totals,
    warnings: totals
      .filter((t) => t.balance < 0)
      .map((t) => ({ code: "fund-negative" as const, currency: t.currency, balance: t.balance })),
    violation,
  };
}
