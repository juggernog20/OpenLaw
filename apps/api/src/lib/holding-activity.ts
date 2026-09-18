// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Activity a Holding write appends (ENT-003): one entry on each
 * Entity of the link. Shared by the hand-typed Holdings routes and the
 * ENT-011 projection that rewrites Holdings from a share register.
 */
import type { Transaction } from "@openlaw/db";
import { recordActivity } from "./activity.js";

export type HoldingActivityInput = Readonly<
  {
    actorId: string;
    ownerId: string;
    ownerIndividual?: boolean;
    ownerName: string;
    ownedId: string;
    ownedName: string;
  } & (
    | { action: "entity_holding.updated"; from: number; to: number }
    | { action: "entity_holding.created" | "entity_holding.deleted"; ownershipPercent: number }
  )
>;

export async function recordHoldingActivity(tx: Transaction, input: HoldingActivityInput) {
  for (const [entityId, legalName] of [
    [input.ownerId, input.ownerName],
    [input.ownedId, input.ownedName],
  ] as const) {
    if (input.ownerIndividual && entityId === input.ownerId) continue;
    const common = {
      entityType: "entity" as const,
      entityId,
      actorId: input.actorId,
      action: input.action,
      visibility: "legal_only" as const,
    };
    if (input.action === "entity_holding.updated") {
      await recordActivity(tx, {
        ...common,
        action: input.action,
        payload: {
          legalName,
          ownerName: input.ownerName,
          ownedName: input.ownedName,
          from: input.from,
          to: input.to,
        },
      });
    } else {
      await recordActivity(tx, {
        ...common,
        action: input.action,
        payload: {
          legalName,
          ownerName: input.ownerName,
          ownedName: input.ownedName,
          ownershipPercent: input.ownershipPercent,
        },
      });
    }
  }
}
