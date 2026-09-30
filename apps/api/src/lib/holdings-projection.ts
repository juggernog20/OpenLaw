// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Holdings projected from a share register (ENT-011, amending ENT-003).
 *
 * After every entry write on an issuer, its owner Holdings are rewritten
 * from today's holders: each holder's outstanding shares across every
 * class over the issuer's outstanding shares, to two decimals. This is
 * the only writer of a Holding (ENT-012). Each change is one
 * `entity_holding.*` Activity entry.
 *
 * Runs inside the register write's transaction, under the Holdings
 * advisory lock, so the ownership graph the cycle check reads is the
 * one it commits.
 */
import {
  and,
  entities,
  entityHoldings,
  entityShareEntries,
  entityShareholders,
  eq,
  individualHoldings,
  type Transaction,
} from "@openlaw/db";
import { recordHoldingActivity } from "./holding-activity.js";
import { replayRegister, todayIsoDate } from "./share-register.js";

const INDIVIDUAL_PREFIX = "individual:";

function percentOf(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0;
}

export async function projectRegisterHoldings(
  tx: Transaction,
  actorId: string,
  issuer: { id: string; legalName: string },
) {
  const [holders, entryRows] = await Promise.all([
    tx
      .select({
        id: entityShareholders.id,
        kind: entityShareholders.kind,
        name: entityShareholders.name,
        holderEntityId: entityShareholders.holderEntityId,
        holderEntityName: entities.legalName,
      })
      .from(entityShareholders)
      .leftJoin(entities, eq(entityShareholders.holderEntityId, entities.id))
      .where(eq(entityShareholders.entityId, issuer.id)),
    tx.select().from(entityShareEntries).where(eq(entityShareEntries.entityId, issuer.id)),
  ]);
  const state = replayRegister(
    {
      classes: [],
      entries: entryRows.map((row) => ({
        id: row.id,
        entryNo: row.entryNo,
        kind: row.kind,
        effectiveOn: row.effectiveOn,
        shareClassId: row.shareClassId,
        toShareClassId: row.toShareClassId,
        quantity: row.quantity,
        fromHolderId: row.fromHolderId,
        toHolderId: row.toHolderId,
      })),
      certificates: [],
    },
    todayIsoDate(),
  );
  const held = new Map<string, number>();
  let outstanding = 0;
  for (const row of state.balances) {
    held.set(row.holderId, (held.get(row.holderId) ?? 0) + row.balance);
    outstanding += row.balance;
  }
  const wanted = new Map<
    string,
    { holderEntityId: string | null; name: string; percent: number; holderId: string }
  >();
  for (const holder of holders) {
    const shares = held.get(holder.id) ?? 0;
    if (shares <= 0) continue;
    wanted.set(holder.id, {
      holderId: holder.id,
      holderEntityId: holder.holderEntityId,
      name: holder.kind === "entity" ? (holder.holderEntityName ?? "") : (holder.name ?? ""),
      percent: percentOf(shares, outstanding),
    });
  }

  // Entity holders → entity_holdings(owner = holder, owned = issuer).
  const current = await tx
    .select({
      ownerEntityId: entityHoldings.ownerEntityId,
      ownerName: entities.legalName,
      ownershipPercent: entityHoldings.ownershipPercent,
    })
    .from(entityHoldings)
    .innerJoin(entities, eq(entityHoldings.ownerEntityId, entities.id))
    .where(eq(entityHoldings.ownedEntityId, issuer.id));
  const wantedByEntity = new Map(
    [...wanted.values()]
      .filter((row) => row.holderEntityId)
      .map((row) => [row.holderEntityId!, row] as const),
  );
  for (const row of current) {
    const next = wantedByEntity.get(row.ownerEntityId);
    if (next) {
      const from = Number(row.ownershipPercent);
      if (from !== next.percent) {
        await tx
          .update(entityHoldings)
          .set({ ownershipPercent: String(next.percent), updatedAt: new Date() })
          .where(
            and(
              eq(entityHoldings.ownerEntityId, row.ownerEntityId),
              eq(entityHoldings.ownedEntityId, issuer.id),
            ),
          );
        await recordHoldingActivity(tx, {
          action: "entity_holding.updated",
          actorId,
          ownerId: row.ownerEntityId,
          ownerName: row.ownerName,
          ownedId: issuer.id,
          ownedName: issuer.legalName,
          from,
          to: next.percent,
        });
      }
      wantedByEntity.delete(row.ownerEntityId);
    } else {
      await tx
        .delete(entityHoldings)
        .where(
          and(
            eq(entityHoldings.ownerEntityId, row.ownerEntityId),
            eq(entityHoldings.ownedEntityId, issuer.id),
          ),
        );
      await recordHoldingActivity(tx, {
        action: "entity_holding.deleted",
        actorId,
        ownerId: row.ownerEntityId,
        ownerName: row.ownerName,
        ownedId: issuer.id,
        ownedName: issuer.legalName,
        ownershipPercent: Number(row.ownershipPercent),
      });
    }
  }
  for (const [ownerEntityId, next] of wantedByEntity) {
    await tx.insert(entityHoldings).values({
      ownerEntityId,
      ownedEntityId: issuer.id,
      ownershipPercent: String(next.percent),
    });
    await recordHoldingActivity(tx, {
      action: "entity_holding.created",
      actorId,
      ownerId: ownerEntityId,
      ownerName: next.name,
      ownedId: issuer.id,
      ownedName: issuer.legalName,
      ownershipPercent: next.percent,
    });
  }

  // Individual holders → individual_holdings, matched by holder id.
  const individuals = await tx
    .select({
      id: individualHoldings.id,
      name: individualHoldings.name,
      ownershipPercent: individualHoldings.ownershipPercent,
      shareholderId: individualHoldings.shareholderId,
    })
    .from(individualHoldings)
    .where(eq(individualHoldings.ownedEntityId, issuer.id));
  const wantedByHolder = new Map(
    [...wanted.values()].filter((row) => !row.holderEntityId).map((row) => [row.holderId, row]),
  );
  for (const row of individuals) {
    const next = wantedByHolder.get(row.shareholderId);
    if (next) {
      const from = Number(row.ownershipPercent);
      if (from !== next.percent || row.name !== next.name) {
        await tx
          .update(individualHoldings)
          .set({ ownershipPercent: String(next.percent), name: next.name, updatedAt: new Date() })
          .where(eq(individualHoldings.id, row.id));
        if (from !== next.percent) {
          await recordHoldingActivity(tx, {
            action: "entity_holding.updated",
            actorId,
            ownerId: INDIVIDUAL_PREFIX + row.id,
            ownerIndividual: true,
            ownerName: next.name,
            ownedId: issuer.id,
            ownedName: issuer.legalName,
            from,
            to: next.percent,
          });
        }
      }
      wantedByHolder.delete(row.shareholderId);
    } else {
      await tx.delete(individualHoldings).where(eq(individualHoldings.id, row.id));
      await recordHoldingActivity(tx, {
        action: "entity_holding.deleted",
        actorId,
        ownerId: INDIVIDUAL_PREFIX + row.id,
        ownerIndividual: true,
        ownerName: row.name,
        ownedId: issuer.id,
        ownedName: issuer.legalName,
        ownershipPercent: Number(row.ownershipPercent),
      });
    }
  }
  const inserted = [...wantedByHolder.values()];
  if (inserted.length > 0) {
    const rows = await tx
      .insert(individualHoldings)
      .values(
        inserted.map((next) => ({
          ownedEntityId: issuer.id,
          name: next.name,
          ownershipPercent: String(next.percent),
          shareholderId: next.holderId,
        })),
      )
      .returning({ id: individualHoldings.id, shareholderId: individualHoldings.shareholderId });
    for (const row of rows) {
      const next = wantedByHolder.get(row.shareholderId)!;
      await recordHoldingActivity(tx, {
        action: "entity_holding.created",
        actorId,
        ownerId: INDIVIDUAL_PREFIX + row.id,
        ownerIndividual: true,
        ownerName: next.name,
        ownedId: issuer.id,
        ownedName: issuer.legalName,
        ownershipPercent: next.percent,
      });
    }
  }
}
