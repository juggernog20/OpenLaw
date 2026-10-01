// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-014 replay, ordered by effective date then entry number. Stated percentages
 * use exact hundredths; unreturned capital includes net assignments alongside payments.
 */

import type { PartnershipBasis, PartnershipCapacity, PartnershipEntryKind } from "@openlaw/db";

export interface PartnershipEntry {
  id: string;
  entryNo: number;
  kind: PartnershipEntryKind;
  effectiveOn: string;
  partyId: string | null;
  fromPartyId: string | null;
  toPartyId: string | null;
  capacity: PartnershipCapacity | null;
  transfereeStatus: "admitted" | "assignee" | null;
  units: number | null;
  statedPercent: string | null;
  amount: number | null;
  currency: string | null;
}
export interface Partner {
  partyId: string;
  capacity: PartnershipCapacity | null;
  status: "admitted" | "assignee" | "ceased";
  since: string | null;
  units: number;
  statedPercent: number;
  committed: number;
  contributed: number;
  returned: number;
  /** Net capital assigned in or out; transfers do not rewrite payments. */
  transferred: number;
  unreturned: number;
  percent: number;
}
const totalsOf = (partners: Partner[]) =>
  partners.reduce(
    (t, p) => ({
      units: t.units + p.units,
      statedPercent: t.statedPercent + Math.round(p.statedPercent * 100),
      committed: t.committed + p.committed,
      contributed: t.contributed + p.contributed,
      returned: t.returned + p.returned,
      unreturned: t.unreturned + p.unreturned,
    }),
    { units: 0, statedPercent: 0, committed: 0, contributed: 0, returned: 0, unreturned: 0 },
  );

/** Dated facts only. Call through END_OF_TIME to validate a proposed write. */
export function replayPartnershipRegister(
  input: { parties: readonly { id: string; kind: string }[]; entries: readonly PartnershipEntry[] },
  asOf: string,
  basis: PartnershipBasis = "capital",
): {
  partners: Partner[];
  totals: ReturnType<typeof totalsOf>;
  currency: string | null;
  violation: { code: string; entryId: string; entryNo: number; detail: string } | null;
  warnings: { code: "stated-total"; total: number }[];
} {
  const states = new Map<string, Partner>();
  const parties = new Map(input.parties.map((p) => [p.id, p]));
  let currency: string | null = null;
  let violation: { code: string; entryId: string; entryNo: number; detail: string } | null = null;
  const fail = (e: PartnershipEntry, code: string, detail: string) => {
    violation = {
      code,
      entryId: e.id,
      entryNo: e.entryNo,
      detail: `Entry ${e.entryNo}: ${detail}`,
    };
  };
  const fresh = (partyId: string): Partner => ({
    partyId,
    capacity: null,
    status: "assignee",
    since: null,
    units: 0,
    statedPercent: 0,
    committed: 0,
    contributed: 0,
    returned: 0,
    transferred: 0,
    unreturned: 0,
    percent: 0,
  });
  for (const e of [...input.entries].sort(
    (a, b) => a.effectiveOn.localeCompare(b.effectiveOn) || a.entryNo - b.entryNo,
  )) {
    if (e.effectiveOn > asOf) break;
    const ids = e.kind === "transfer" ? [e.fromPartyId, e.toPartyId] : [e.partyId];
    if (ids.some((id) => !id || !parties.has(id) || parties.get(id)!.kind === "class")) {
      fail(e, "invalid-party", "Choose an Entity or individual on this register.");
      break;
    }
    if (e.currency) {
      if (currency && currency !== e.currency) {
        fail(
          e,
          "currency-mismatch",
          `This register uses ${currency}; a second currency is not allowed.`,
        );
        break;
      }
      currency = e.currency;
    }
    const p = states.get(e.partyId ?? e.fromPartyId!);
    if (e.kind === "admission") {
      if (p?.status === "admitted") {
        fail(e, "duplicate-admission", "The party is already admitted.");
        break;
      }
      const next = p ?? fresh(e.partyId!);
      next.status = "admitted";
      next.capacity = e.capacity;
      next.since = e.effectiveOn;
      next.units += e.units ?? 0;
      next.statedPercent =
        (Math.round(next.statedPercent * 100) + Math.round(Number(e.statedPercent ?? 0) * 100)) /
        100;
      states.set(next.partyId, next);
    } else {
      if (!p || p.status === "ceased") {
        fail(e, "not-standing", "The party is not admitted or an assignee on this date.");
        break;
      }
      switch (e.kind) {
        case "commitment":
          p.committed += e.amount!;
          break;
        case "contribution":
          p.contributed += e.amount!;
          p.unreturned += e.amount!;
          break;
        case "return":
          p.returned += e.amount!;
          p.unreturned -= e.amount!;
          break;
        case "capacity_change":
          if (p.status === "assignee") p.since = e.effectiveOn;
          p.status = "admitted";
          p.capacity = e.capacity;
          break;
        case "withdrawal":
          if (p.units || p.statedPercent || p.unreturned) {
            fail(
              e,
              "withdrawal-balance",
              "A party must hold no units, stated percent or unreturned capital before withdrawal.",
            );
            break;
          }
          p.status = "ceased";
          break;
        case "transfer": {
          if (e.fromPartyId === e.toPartyId) {
            fail(e, "same-party", "A transfer requires two different parties.");
            break;
          }
          let to = states.get(e.toPartyId!);
          if (!to || to.status === "ceased") {
            if (!e.transfereeStatus) {
              fail(
                e,
                "transferee-status",
                "Say whether the transferee is admitted or an assignee.",
              );
              break;
            }
            to = to ?? fresh(e.toPartyId!);
            to.status = e.transfereeStatus;
            to.capacity = to.status === "admitted" ? e.capacity : null;
            to.since = to.status === "admitted" ? e.effectiveOn : null;
            states.set(to.partyId, to);
          } else if (to.status === "assignee" && e.transfereeStatus === "admitted") {
            to.status = "admitted";
            to.capacity = e.capacity;
            to.since = e.effectiveOn;
          }
          p.units -= e.units ?? 0;
          to.units += e.units ?? 0;
          const percent = Math.round(Number(e.statedPercent ?? 0) * 100);
          p.statedPercent = (Math.round(p.statedPercent * 100) - percent) / 100;
          to.statedPercent = (Math.round(to.statedPercent * 100) + percent) / 100;
          const amount = e.amount ?? 0;
          p.transferred -= amount;
          to.transferred += amount;
          p.unreturned -= amount;
          to.unreturned += amount;
          break;
        }
      }
    }
    if (violation) break;
    const rows = [...states.values()];
    if (rows.some((p) => p.units < 0 || p.statedPercent < 0 || p.unreturned < 0)) {
      fail(
        e,
        "negative-balance",
        "Units, stated percent and unreturned capital cannot be negative.",
      );
      break;
    }
    if (rows.some((p) => p.statedPercent > 100)) {
      fail(e, "percent-range", "One party cannot hold more than 100 percent.");
      break;
    }
    if (
      rows.some((p) =>
        [p.units, p.committed, p.contributed, p.returned, p.transferred, p.unreturned].some(
          (n) => !Number.isSafeInteger(n),
        ),
      ) ||
      Object.values(totalsOf(rows)).some((n) => !Number.isSafeInteger(n))
    ) {
      fail(e, "number-range", "The balance or register total exceeds the safe integer range.");
      break;
    }
  }
  const partners = [...states.values()];
  const totals = totalsOf(partners);
  totals.statedPercent /= 100;
  const admitted = partners.filter((p) => p.status === "admitted").length;
  for (const p of partners) {
    const part =
      basis === "capital"
        ? p.unreturned
        : basis === "units"
          ? p.units
          : p.status === "admitted"
            ? 1
            : 0;
    const whole =
      basis === "capital" ? totals.unreturned : basis === "units" ? totals.units : admitted;
    p.percent =
      basis === "stated"
        ? p.statedPercent
        : whole > 0
          ? Math.round((part / whole) * 10000) / 100
          : 0;
  }
  return {
    partners,
    totals,
    currency,
    violation,
    warnings:
      basis === "stated" && totals.statedPercent !== 100
        ? [{ code: "stated-total" as const, total: totals.statedPercent }]
        : [],
  };
}
