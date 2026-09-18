// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  END_OF_TIME,
  orderEntries,
  replayRegister,
  type ReplayCertificate,
  type ReplayEntry,
} from "./share-register.js";

const ORD = { id: "ord", authorized: 1_000_000, votesPerShare: 1 };
const PREF = { id: "pref", authorized: 250_000, votesPerShare: 1 };
const CLASSES = [ORD, PREF];

let counter = 0;
function entry(input: Partial<ReplayEntry> & Pick<ReplayEntry, "kind" | "quantity">): ReplayEntry {
  counter += 1;
  return {
    id: input.id ?? `e${counter}`,
    entryNo: input.entryNo ?? counter,
    effectiveOn: input.effectiveOn ?? "2024-01-01",
    shareClassId: input.shareClassId ?? "ord",
    toShareClassId: input.toShareClassId ?? null,
    fromHolderId: input.fromHolderId ?? null,
    toHolderId: input.toHolderId ?? null,
    kind: input.kind,
    quantity: input.quantity,
  };
}

function balance(state: ReturnType<typeof replayRegister>, holderId: string, classId = "ord") {
  return (
    state.balances.find((row) => row.holderId === holderId && row.shareClassId === classId)
      ?.balance ?? 0
  );
}

describe("the share register replay", () => {
  it("applies allotment, transfer, buyback, cancellation and conversion in order", () => {
    const entries = [
      entry({ kind: "allotment", quantity: 550_000, toHolderId: "wfo", effectiveOn: "2019-03-12" }),
      entry({
        kind: "allotment",
        quantity: 200_000,
        toHolderId: "blair",
        effectiveOn: "2019-03-12",
      }),
      entry({ kind: "buyback", quantity: 50_000, fromHolderId: "wfo", effectiveOn: "2020-12-10" }),
      entry({
        kind: "transfer",
        quantity: 50_000,
        fromHolderId: "wfo",
        toHolderId: "harbour",
        effectiveOn: "2021-06-30",
      }),
      entry({
        kind: "allotment",
        quantity: 120_000,
        toHolderId: "meridian",
        shareClassId: "pref",
        effectiveOn: "2022-11-15",
      }),
      entry({ kind: "cancellation", quantity: 10_000, effectiveOn: "2023-01-01" }),
      entry({
        kind: "conversion",
        quantity: 20_000,
        fromHolderId: "meridian",
        toHolderId: "meridian",
        shareClassId: "pref",
        toShareClassId: "ord",
        effectiveOn: "2024-05-01",
      }),
    ];
    const state = replayRegister({ classes: CLASSES, entries, certificates: [] }, END_OF_TIME);
    expect(state.violation).toBeNull();
    expect(balance(state, "wfo")).toBe(450_000);
    expect(balance(state, "blair")).toBe(200_000);
    expect(balance(state, "harbour")).toBe(50_000);
    expect(balance(state, "meridian", "pref")).toBe(100_000);
    expect(balance(state, "meridian", "ord")).toBe(20_000);
    expect(state.treasury.get("ord")).toBe(40_000);
    expect(state.issued.get("ord")).toBe(750_000 - 10_000 + 20_000);
    expect(state.issued.get("pref")).toBe(100_000);
    expect(state.memberSince.get("harbour")).toBe("2021-06-30");
    expect(state.applied).toHaveLength(7);
  });

  it("orders same-day entries by entry number, so a transfer can follow its allotment", () => {
    const entries = [
      entry({ kind: "transfer", quantity: 10, fromHolderId: "a", toHolderId: "b", entryNo: 2 }),
      entry({ kind: "allotment", quantity: 10, toHolderId: "a", entryNo: 1 }),
    ];
    expect(orderEntries(entries).map((row) => row.entryNo)).toEqual([1, 2]);
    const state = replayRegister({ classes: CLASSES, entries, certificates: [] }, END_OF_TIME);
    expect(state.violation).toBeNull();
    expect(balance(state, "b")).toBe(10);
  });

  it("reads the register as of a date and ignores what came after", () => {
    const entries = [
      entry({ kind: "allotment", quantity: 100, toHolderId: "a", effectiveOn: "2024-01-01" }),
      entry({
        kind: "transfer",
        quantity: 40,
        fromHolderId: "a",
        toHolderId: "b",
        effectiveOn: "2024-06-01",
      }),
    ];
    const before = replayRegister({ classes: CLASSES, entries, certificates: [] }, "2023-12-31");
    expect(before.applied).toHaveLength(0);
    expect(before.balances).toEqual([]);
    const between = replayRegister({ classes: CLASSES, entries, certificates: [] }, "2024-05-31");
    expect(balance(between, "a")).toBe(100);
    expect(balance(between, "b")).toBe(0);
    const onTheDay = replayRegister({ classes: CLASSES, entries, certificates: [] }, "2024-06-01");
    expect(balance(onTheDay, "a")).toBe(60);
    expect(balance(onTheDay, "b")).toBe(40);
  });

  it("refuses the first step that takes a holder, treasury or the issued count below zero", () => {
    const overdrawn = replayRegister(
      {
        classes: CLASSES,
        entries: [
          entry({ kind: "allotment", quantity: 10, toHolderId: "a", entryNo: 1 }),
          entry({ kind: "transfer", quantity: 11, fromHolderId: "a", toHolderId: "b", entryNo: 2 }),
        ],
        certificates: [],
      },
      END_OF_TIME,
    );
    expect(overdrawn.violation?.entryNo).toBe(2);
    expect(overdrawn.violation?.detail).toMatch(/holder's balance below zero/);

    const emptyTreasury = replayRegister(
      {
        classes: CLASSES,
        entries: [entry({ kind: "cancellation", quantity: 1 })],
        certificates: [],
      },
      END_OF_TIME,
    );
    expect(emptyTreasury.violation?.detail).toMatch(/treasury below zero/);

    const fromHolder = replayRegister(
      {
        classes: CLASSES,
        entries: [
          entry({ kind: "allotment", quantity: 5, toHolderId: "a", entryNo: 1 }),
          entry({ kind: "cancellation", quantity: 5, fromHolderId: "a", entryNo: 2 }),
        ],
        certificates: [],
      },
      END_OF_TIME,
    );
    expect(fromHolder.violation).toBeNull();
    expect(fromHolder.issued.get("ord")).toBe(0);
    expect(fromHolder.balances).toEqual([]);
  });

  it("keeps certificates honest: cancelled ones must be live for that holder and class", () => {
    const entries = [
      entry({ id: "allot", kind: "allotment", quantity: 100, toHolderId: "a", entryNo: 1 }),
      entry({
        id: "move",
        kind: "transfer",
        quantity: 40,
        fromHolderId: "a",
        toHolderId: "b",
        entryNo: 2,
      }),
    ];
    const certificates: ReplayCertificate[] = [
      {
        id: "c1",
        number: "001",
        holderId: "a",
        shareClassId: "ord",
        quantity: 100,
        issuedByEntryId: "allot",
        cancelledByEntryId: "move",
      },
      {
        id: "c2",
        number: "002",
        holderId: "a",
        shareClassId: "ord",
        quantity: 60,
        issuedByEntryId: "move",
        cancelledByEntryId: null,
      },
      {
        id: "c3",
        number: "003",
        holderId: "b",
        shareClassId: "ord",
        quantity: 40,
        issuedByEntryId: "move",
        cancelledByEntryId: null,
      },
    ];
    const sound = replayRegister({ classes: CLASSES, entries, certificates }, END_OF_TIME);
    expect(sound.violation).toBeNull();
    expect(sound.liveCertificates.map((row) => row.number).sort()).toEqual(["002", "003"]);

    const wrongHolder = replayRegister(
      {
        classes: CLASSES,
        entries,
        certificates: [{ ...certificates[0]!, holderId: "b" }, certificates[1]!, certificates[2]!],
      },
      END_OF_TIME,
    );
    expect(wrongHolder.violation?.detail).toMatch(/another holder or class/);

    const notLive = replayRegister(
      {
        classes: CLASSES,
        entries,
        certificates: [
          { ...certificates[0]!, issuedByEntryId: "move", cancelledByEntryId: "move" },
          certificates[1]!,
          certificates[2]!,
        ],
      },
      END_OF_TIME,
    );
    expect(notLive.violation?.detail).toMatch(/not live/);

    const overCertified = replayRegister(
      {
        classes: CLASSES,
        entries,
        certificates: [certificates[0]!, { ...certificates[1]!, quantity: 61 }, certificates[2]!],
      },
      END_OF_TIME,
    );
    expect(overCertified.violation?.detail).toMatch(/more shares than they hold/);
  });

  it("warns, and does not refuse, when allotments pass the authorized count", () => {
    const state = replayRegister(
      {
        classes: [{ id: "ord", authorized: 100, votesPerShare: 1 }],
        entries: [entry({ kind: "allotment", quantity: 150, toHolderId: "a" })],
        certificates: [],
      },
      END_OF_TIME,
    );
    expect(state.violation).toBeNull();
    expect(state.warnings).toEqual([
      { code: "authorized-exceeded", shareClassId: "ord", issued: 150, authorized: 100 },
    ]);
  });
});
