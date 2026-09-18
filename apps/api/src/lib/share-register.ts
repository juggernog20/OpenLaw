// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The share register replay (ENT-011). Balances are never stored: the
 * Register of members at a date is the entries on or before that date,
 * applied in order, to nothing. The same replay validates a write, by
 * running the register with the change applied and refusing the first
 * step that takes any balance below zero or cancels a certificate that
 * is not live. It is pure so the rules can be tested without a database.
 */

export type ReplayKind = "allotment" | "transfer" | "buyback" | "cancellation" | "conversion";

export interface ReplayClass {
  id: string;
  authorized: number | null;
  votesPerShare: number;
}

export interface ReplayEntry {
  id: string;
  entryNo: number;
  kind: ReplayKind;
  /** ISO calendar date. */
  effectiveOn: string;
  shareClassId: string;
  toShareClassId: string | null;
  quantity: number;
  fromHolderId: string | null;
  toHolderId: string | null;
}

export interface ReplayCertificate {
  id: string;
  number: string;
  holderId: string;
  shareClassId: string;
  quantity: number;
  issuedByEntryId: string;
  cancelledByEntryId: string | null;
}

export interface ReplayViolation {
  entryId: string;
  entryNo: number;
  detail: string;
}

export interface ReplayWarning {
  code: "authorized-exceeded";
  shareClassId: string;
  issued: number;
  authorized: number;
}

export interface ReplayState {
  /** Entries on or before the date, in the order they were applied. */
  applied: ReplayEntry[];
  /** Holder balance per class. Only positive balances are listed. */
  balances: { holderId: string; shareClassId: string; balance: number }[];
  /** Shares the company holds, per class. */
  treasury: Map<string, number>;
  /** Allotted minus cancelled, per class. Treasury shares are issued. */
  issued: Map<string, number>;
  /** The first date each holder held anything. Whether they still do is
   * a question for `balances`. */
  memberSince: Map<string, string>;
  /** Certificates issued by an applied entry and not cancelled by one. */
  liveCertificates: ReplayCertificate[];
  /** The first step that broke a rule, or null when the register is sound. */
  violation: ReplayViolation | null;
  warnings: ReplayWarning[];
}

/** The register's order: effective date, then the number assigned on insert. */
export function orderEntries<T extends { effectiveOn: string; entryNo: number }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) => a.effectiveOn.localeCompare(b.effectiveOn) || a.entryNo - b.entryNo,
  );
}

const key = (holderId: string, shareClassId: string) => `${holderId}|${shareClassId}`;

export function replayRegister(
  input: {
    classes: readonly ReplayClass[];
    entries: readonly ReplayEntry[];
    certificates: readonly ReplayCertificate[];
  },
  asOf: string,
): ReplayState {
  const balances = new Map<string, number>();
  const treasury = new Map<string, number>();
  const issued = new Map<string, number>();
  const memberSince = new Map<string, string>();
  const applied: ReplayEntry[] = [];
  const issuedBy = new Map<string, ReplayCertificate[]>();
  const cancelledBy = new Map<string, ReplayCertificate[]>();
  for (const certificate of input.certificates) {
    const issuedList = issuedBy.get(certificate.issuedByEntryId) ?? [];
    issuedList.push(certificate);
    issuedBy.set(certificate.issuedByEntryId, issuedList);
    if (certificate.cancelledByEntryId) {
      const cancelledList = cancelledBy.get(certificate.cancelledByEntryId) ?? [];
      cancelledList.push(certificate);
      cancelledBy.set(certificate.cancelledByEntryId, cancelledList);
    }
  }
  const live = new Map<string, ReplayCertificate>();
  let violation: ReplayViolation | null = null;

  // Totals live in JS numbers, so a sum past the safe-integer range would
  // round silently. That is a violation too, not a bigger number.
  const unsafe = (value: number, entry: ReplayEntry) => {
    if (Number.isSafeInteger(value)) return false;
    violation ??= {
      entryId: entry.id,
      entryNo: entry.entryNo,
      detail: `Entry ${entry.entryNo} would take a total past the largest count the register can hold.`,
    };
    return true;
  };

  const move = (holderId: string, shareClassId: string, delta: number, entry: ReplayEntry) => {
    const k = key(holderId, shareClassId);
    const next = (balances.get(k) ?? 0) + delta;
    if (unsafe(next, entry)) return;
    if (next < 0 && !violation) {
      violation = {
        entryId: entry.id,
        entryNo: entry.entryNo,
        detail: `Entry ${entry.entryNo} would take a holder's balance below zero.`,
      };
    }
    balances.set(k, next);
    if (next > 0 && !memberSince.has(holderId)) memberSince.set(holderId, entry.effectiveOn);
  };
  const bump = (
    map: Map<string, number>,
    id: string,
    delta: number,
    entry: ReplayEntry,
    what: string,
  ) => {
    const next = (map.get(id) ?? 0) + delta;
    if (unsafe(next, entry)) return;
    if (next < 0 && !violation) {
      violation = {
        entryId: entry.id,
        entryNo: entry.entryNo,
        detail: `Entry ${entry.entryNo} would take ${what} below zero.`,
      };
    }
    map.set(id, next);
  };

  for (const entry of orderEntries(input.entries)) {
    if (entry.effectiveOn > asOf) break;
    applied.push(entry);
    switch (entry.kind) {
      case "allotment":
        move(entry.toHolderId!, entry.shareClassId, entry.quantity, entry);
        bump(issued, entry.shareClassId, entry.quantity, entry, "the issued count");
        break;
      case "transfer":
        move(entry.fromHolderId!, entry.shareClassId, -entry.quantity, entry);
        move(entry.toHolderId!, entry.shareClassId, entry.quantity, entry);
        break;
      case "buyback":
        move(entry.fromHolderId!, entry.shareClassId, -entry.quantity, entry);
        bump(treasury, entry.shareClassId, entry.quantity, entry, "treasury");
        break;
      case "cancellation":
        if (entry.fromHolderId)
          move(entry.fromHolderId, entry.shareClassId, -entry.quantity, entry);
        else bump(treasury, entry.shareClassId, -entry.quantity, entry, "treasury");
        bump(issued, entry.shareClassId, -entry.quantity, entry, "the issued count");
        break;
      case "conversion":
        move(entry.fromHolderId!, entry.shareClassId, -entry.quantity, entry);
        move(entry.fromHolderId!, entry.toShareClassId!, entry.quantity, entry);
        bump(issued, entry.shareClassId, -entry.quantity, entry, "the issued count");
        bump(issued, entry.toShareClassId!, entry.quantity, entry, "the issued count");
        break;
    }
    // Certificates: the ones this entry cancels must be live, for the
    // holder the shares leave, in the class they leave; then the ones
    // it issues join the live set.
    for (const certificate of cancelledBy.get(entry.id) ?? []) {
      const current = live.get(certificate.id);
      if (!current) {
        violation ??= {
          entryId: entry.id,
          entryNo: entry.entryNo,
          detail: `Entry ${entry.entryNo} cancels certificate ${certificate.number}, which is not live on that date.`,
        };
        continue;
      }
      if (current.holderId !== entry.fromHolderId || current.shareClassId !== entry.shareClassId) {
        violation ??= {
          entryId: entry.id,
          entryNo: entry.entryNo,
          detail: `Entry ${entry.entryNo} cancels certificate ${certificate.number}, which belongs to another holder or class.`,
        };
      }
      live.delete(certificate.id);
    }
    for (const certificate of issuedBy.get(entry.id) ?? []) live.set(certificate.id, certificate);
    // A holder's live certificates cannot say more than the holder has.
    const touched = new Set<string>();
    if (entry.fromHolderId) {
      touched.add(key(entry.fromHolderId, entry.shareClassId));
      if (entry.toShareClassId) touched.add(key(entry.fromHolderId, entry.toShareClassId));
    }
    if (entry.toHolderId) touched.add(key(entry.toHolderId, entry.shareClassId));
    for (const k of touched) {
      const [holderId, shareClassId] = k.split("|") as [string, string];
      let certified = 0;
      for (const certificate of live.values()) {
        if (certificate.holderId === holderId && certificate.shareClassId === shareClassId)
          certified += certificate.quantity;
      }
      if (unsafe(certified, entry)) continue;
      if (certified > (balances.get(k) ?? 0)) {
        violation ??= {
          entryId: entry.id,
          entryNo: entry.entryNo,
          detail: `After entry ${entry.entryNo}, a holder's live certificates would cover more shares than they hold.`,
        };
      }
    }
  }

  const warnings: ReplayWarning[] = [];
  for (const shareClass of input.classes) {
    const count = issued.get(shareClass.id) ?? 0;
    if (shareClass.authorized !== null && count > shareClass.authorized) {
      warnings.push({
        code: "authorized-exceeded",
        shareClassId: shareClass.id,
        issued: count,
        authorized: shareClass.authorized,
      });
    }
  }
  return {
    applied,
    balances: [...balances.entries()]
      .filter(([, balance]) => balance > 0)
      .map(([k, balance]) => {
        const [holderId, shareClassId] = k.split("|") as [string, string];
        return { holderId, shareClassId, balance };
      }),
    treasury,
    issued,
    memberSince,
    liveCertificates: [...live.values()],
    violation,
    warnings,
  };
}

/** The far end of the calendar: replaying to it validates every entry. */
export const END_OF_TIME = "9999-12-31";

export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
