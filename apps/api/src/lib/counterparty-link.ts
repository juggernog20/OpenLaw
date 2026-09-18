// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-011's inline creation: a typed name becomes a counterparty record.
 *
 * It answers the record we already hold under that name before it
 * makes a new one, so a typeahead cannot leave two rows behind for one
 * organization. Two callers share it: the contract's add-counterparty
 * route, and INT-002's conversion, which lands the "Counterparty name"
 * a requester typed onto the contract it makes.
 *
 * The advisory lock is transaction-scoped and keyed on the name, so
 * two Legal Team Members typing the same unknown name onto two
 * different contracts at the same moment take turns: the first
 * creates, the second finds. Locking the contract row cannot do this,
 * because they are on different contracts. A unique constraint on the
 * name would be a permanent ruling that two organizations may never
 * share one, which is not ours to make here.
 */

import {
  and,
  asc,
  contractCounterparties,
  counterparties,
  eq,
  isNull,
  sql,
  type Transaction,
} from "@openlaw/db";
import { MAX_COUNTERPARTY_NAME_LENGTH } from "@openlaw/shared";
import { z } from "zod";
import { httpError } from "./problem.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "./activity.js";

/** The name and nothing else, as every inline creation writes it. */
export const CounterpartyNameSchema = z.string().trim().min(1).max(MAX_COUNTERPARTY_NAME_LENGTH);

export interface LinkedCounterparty {
  id: string;
  name: string;
}

export async function findOrCreateCounterparty(
  tx: Transaction,
  rawName: string,
): Promise<{ counterparty: LinkedCounterparty; born: boolean }> {
  const name = rawName.trim();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(${name})))`);
  const [existing] = await tx
    .select({ id: counterparties.id, name: counterparties.name })
    .from(counterparties)
    .where(
      and(
        isNull(counterparties.archivedAt),
        // Matched case-insensitively on the name index's own
        // expression: "helix labs gmbh" is the organization already
        // filed as "Helix Labs GmbH", not a second one.
        sql`lower(${counterparties.name}) = lower(${name})`,
      ),
    )
    .orderBy(asc(counterparties.createdAt))
    .limit(1);
  if (existing) return { counterparty: existing, born: false };

  const [created] = await tx
    .insert(counterparties)
    .values({ name })
    .returning({ id: counterparties.id, name: counterparties.name });
  return { counterparty: created!, born: true };
}

/**
 * Puts the named organization on a newborn contract as its primary
 * (CTR-011). The contract has no parties yet, so the first-party rule
 * the add route applies holds by construction, and the entry is the
 * add route's own, `created` included.
 */
export async function linkPrimaryCounterparty(
  tx: Transaction,
  input: {
    contract: { id: string; number: number; title: string };
    name: string;
    counterpartyId?: string;
    isPrimary?: boolean;
    actorId: string;
  },
): Promise<void> {
  const selected = input.counterpartyId
    ? (
        await tx
          .select({ id: counterparties.id, name: counterparties.name })
          .from(counterparties)
          .where(
            and(eq(counterparties.id, input.counterpartyId), isNull(counterparties.archivedAt)),
          )
          .limit(1)
          .for("update")
      )[0]
    : undefined;
  if (input.counterpartyId && !selected)
    throw httpError(
      400,
      "A selected counterparty is no longer available. Choose a replacement during conversion.",
    );
  const { counterparty: party, born } = selected
    ? { counterparty: selected, born: false }
    : await findOrCreateCounterparty(tx, input.name);
  const inserted = await tx
    .insert(contractCounterparties)
    .values({
      contractId: input.contract.id,
      counterpartyId: party.id,
      isPrimary: input.isPrimary ?? true,
    })
    .onConflictDoNothing({
      target: [contractCounterparties.contractId, contractCounterparties.counterpartyId],
    })
    .returning();
  if (inserted.length === 0) return;
  await recordActivity(tx, {
    entityType: "contract",
    entityId: input.contract.id,
    actorId: input.actorId,
    action: "contract.counterparty_added",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      number: input.contract.number,
      title: input.contract.title,
      counterparty: party.name,
      isPrimary: input.isPrimary ?? true,
      created: born,
    },
  });
}
