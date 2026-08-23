// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract create, as one callable a caller runs inside its own
 * transaction (M21/1).
 *
 * Everything a contract is born with is here: the type row locked and
 * checked live, the CTR-001 draft seed it starts on, the CTR-016 /
 * MTR-014 hard-required fields it cannot be born missing, the CTR-003
 * number the sequence gives it, the CTR-004 creator row, the DD-017
 * `contract.created` narration, and CTR-007's renewal routing when the
 * caller is routing one.
 *
 * **It takes the transaction rather than opening one.** The create
 * route is the first caller and opens its own; the INT-006 conversion
 * of a Request is the second, and its transaction is wider than this
 * write — it dispositions the Request, promotes the paper, and
 * re-parents the thread beside it, and every one of those has to roll
 * back together with the contract. A create that owned its own
 * transaction could not be a step inside that act: a failure after it
 * committed would leave a C-### number on a record nobody asked for.
 * So the caller owns the boundary and this owns the write.
 *
 * Two things are deliberately **not** here.
 *
 * - **Reach.** Who may create a contract is the route's gate, and which
 *   predecessor a viewer may route a renewal from is the route's
 *   question too (CTR-021). The predecessor arrives already locked and
 *   already checked, as a row.
 * - **The projection.** What a contract reads as — the Owner, the
 *   signing entity, the primary counterparty — is the shape an answer
 *   takes, and callers want different ones. This answers the row it
 *   wrote plus the two display names it had to read anyway.
 *
 * What a contract is **not** born with is as much the decision as what
 * it is. No Owner, no team beyond the creator's provenance row, no
 * status but the draft seed, and no Confidential flag unless the caller
 * asks for one. CTR-015's no-inheritance stance, applied at birth, and
 * the same rule the M16 successor obeys.
 *
 * **Risk is never born and priority is born only where a caller holds
 * one** (MTR-012, M21/9). Risk is legal's assessment of how bad it
 * would be if this went wrong, and nobody has made it at the moment a
 * record appears, so there is no way to supply it here. Priority is how
 * fast, and INT-002 maps the requester's urgency onto it 1:1 at
 * conversion — that is a fact somebody stated, carried rather than
 * assessed. The create route holds no such fact and passes none, so an
 * ordinary create still starts on the column's own `medium` default.
 */

import {
  and,
  asc,
  contractCounterparties,
  contracts,
  contractStatuses,
  contractTeam,
  contractTypeFields,
  contractTypes,
  counterparties,
  desc,
  entities,
  eq,
  isNull,
  sql,
  type Contract,
  type ContractStage,
  type CustomFieldValue,
  type Matter,
  type SeverityLevel,
  type Transaction,
} from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { CREATOR_TEAM_ROLE } from "../../lib/contract-access.js";
import { linkContracts, setContractParent } from "../../lib/contract-relations.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { httpError } from "../../lib/problem.js";

/** The protected CTR-001 seed every contract is born on. */
const DRAFT_STATUS_SLUG = "draft";

/**
 * CTR-007's two routed vehicles (M16/5).
 *
 * `child` and `successor` are separate values rather than a relation
 * type, because they are two shapes and not two spellings: a child sits
 * *under* its predecessor in the CTR-015 hierarchy, and a successor
 * stands beside it holding a `renews` link. Naming the link type at the
 * seam would make the caller responsible for a choice the vehicle
 * already makes.
 */
export const CONTRACT_RENEWAL_VEHICLES = ["child", "successor"] as const;

export type ContractRenewalVehicle = (typeof CONTRACT_RENEWAL_VEHICLES)[number];

/**
 * A renewal being routed, as this write needs it: the vehicle, and the
 * predecessor **already locked and already reach-checked** by the
 * caller. The row rather than the number, because the lock has to be
 * taken before anything is copied off it, and the caller is what knows
 * whether this viewer may reach it at all.
 */
export interface ContractRenewalRouting {
  vehicle: ContractRenewalVehicle;
  predecessor: Contract;
}

/** Everything a caller decides about a contract at its birth. */
export interface CreateContractInput {
  /** Who is creating it: the CTR-004 creator row and the actor on every
   * entry this write narrates. */
  actorId: string;
  title: string;
  contractTypeId: string;
  /** The type's fields, keyed by slug. Only the hard-required ones have
   * to be here — the rest are set on the record — and a slug the type
   * does not attach is refused. */
  customFields?: Readonly<Record<string, CustomFieldValue | null>> | undefined;
  /**
   * How fast, where the caller holds a stated one (MTR-012).
   *
   * The one caller that does is INT-002's conversion, which maps the
   * requester's urgency onto it 1:1 — priority is what legal holds and
   * urgency is what the requester claimed, and the claim is the honest
   * starting point. Omitted is the ordinary create, which leaves the
   * column's `medium` default. There is no `risk` beside it: risk is an
   * assessment nobody has made at birth, and a requester never sets it.
   */
  priority?: SeverityLevel | undefined;
  /** DD-014's flag, from the first moment, so a sensitive record is
   * never visible to the wrong audience even briefly. Omitted means
   * open, which is the product's default. */
  isConfidential?: boolean | undefined;
  /** CTR-007's routing. Omitted is the ordinary create: a record that
   * renews nothing and sits under nobody. */
  renewal?: ContractRenewalRouting | null | undefined;
  /** MTR-007's optional broader-work container, already locked,
   * reach-checked, and verified live by the caller. Omitted keeps the
   * Contract standalone. */
  matter?: Pick<Matter, "id" | "number" | "title"> | null | undefined;
}

/**
 * The newborn contract, plus the two labels the write already read.
 *
 * The row is the record itself, so a caller that has to write a
 * back-link — the conversion's `converted_contract_id` — has the id,
 * and one that has to narrate elsewhere has the C-### number. The type
 * name and the status label ride along because the write locked and
 * read both to do its job; a caller re-reading them would be a second
 * query for facts this one already holds.
 */
export interface CreatedContract {
  row: Contract;
  contractTypeName: string;
  statusName: string;
  stage: ContractStage;
}

/**
 * CTR-007's prefill: the business facts a routed renewal is born with.
 *
 * **This list is the decision.** The deal is the same deal — our side of
 * it, what it is worth, and the shape of its term — so re-keying those
 * onto the successor is work with no judgement in it. Everything else is
 * a fact about the *record* rather than the deal: the status says where
 * this paper has got to, the team says who is working it, the Owner says
 * who is accountable for it, priority and risk are assessments nobody
 * has made yet, and the Confidential flag is an audience decision. None
 * of them is inherited (CTR-015), so none of them is here.
 *
 * The term is copied as its **shape**, dates and all. A successor whose
 * dates have not been agreed yet is edited on the record; a successor
 * that simply continues the same commitment is right already. Copying
 * the type without the periods would leave an auto-renewing record that
 * does not know how far it rolls, which is a worse starting point than
 * either.
 */
function businessFactsOf(predecessor: Contract) {
  return {
    entityId: predecessor.entityId,
    valueAmount: predecessor.valueAmount,
    valueCurrency: predecessor.valueCurrency,
    valueCadence: predecessor.valueCadence,
    termType: predecessor.termType,
    effectiveDate: predecessor.effectiveDate,
    expiryDate: predecessor.expiryDate,
    renewalPeriodMonths: predecessor.renewalPeriodMonths,
    noticePeriodDays: predecessor.noticePeriodDays,
  };
}

export async function createContract(
  tx: Transaction,
  input: CreateContractInput,
): Promise<CreatedContract> {
  const { actorId, title, contractTypeId, renewal, matter } = input;
  // Lock the type row so a concurrent archive can't slip between the
  // check and the insert.
  const [contractType] = await tx
    .select({
      id: contractTypes.id,
      displayName: contractTypes.displayName,
      archivedAt: contractTypes.archivedAt,
    })
    .from(contractTypes)
    .where(eq(contractTypes.id, contractTypeId))
    .limit(1)
    .for("update");
  if (!contractType || contractType.archivedAt) {
    throw httpError(400, "The contract type must be a live contract type.");
  }

  // The draft seed is system-protected — no archive, no delete — so it
  // is always there to be born on. The live filter states that
  // invariant rather than assuming it: a contract must never start on a
  // status the pickers refuse to show.
  const [draft] = await tx
    .select({
      id: contractStatuses.id,
      displayName: contractStatuses.displayName,
      stage: contractStatuses.stage,
    })
    .from(contractStatuses)
    .where(and(eq(contractStatuses.slug, DRAFT_STATUS_SLUG), isNull(contractStatuses.archivedAt)))
    .limit(1);
  if (!draft) throw httpError(500, "The draft contract status is missing.");

  // CTR-016's fields, and MTR-014's rule about them: the type says which
  // fields it attaches and which of those it requires, and a record
  // cannot be born missing data its type demands. This is the first of
  // the rule's two enforcement points; the other is a re-type.
  const attached = await selectAttachedFields(tx, contractTypeFields, contractType.id);
  const { values: customFields } = await applyCustomFields(
    tx,
    attached,
    {},
    input.customFields ?? {},
  );
  assertRequiredCustomFields(attached, customFields);

  // CTR-007's prefill, and the whole of it: the business facts of the
  // deal, copied so routing a renewal is not re-keying a contract. The
  // type and the title are the caller's, below, because those are the
  // two the create dialog draws and the person may have edited either
  // before pressing.
  const copied = renewal ? businessFactsOf(renewal.predecessor) : null;
  // Our entity is copied live or not at all, the counterparties' rule
  // (below) applied to our own side: the field write refuses an archived
  // signatory, so nothing new gets signed by an entity that has left the
  // registry — and a copy that carried one onto a *new* record would be
  // the way around that rule. The predecessor keeps what signed it
  // either way (CTR-011).
  //
  // The row is locked for the same reason the field write locks it: an
  // unlocked read lets a concurrent archive commit between the check and
  // the insert, and the record is then born holding what this check
  // exists to keep off it.
  if (copied?.entityId) {
    const [signatory] = await tx
      .select({ archivedAt: entities.archivedAt })
      .from(entities)
      .where(eq(entities.id, copied.entityId))
      .limit(1)
      .for("update");
    if (!signatory || signatory.archivedAt !== null) copied.entityId = null;
  }

  const isConfidential = input.isConfidential ?? false;
  const [row] = await tx
    .insert(contracts)
    .values({
      title: title.trim(),
      contractTypeId: contractType.id,
      statusId: draft.id,
      customFields,
      isConfidential,
      matterId: matter?.id ?? null,
      // Only where the caller holds a stated one; otherwise the column's
      // own `medium` default stands, which is what an unassessed record
      // honestly is (MTR-012).
      ...(input.priority ? { priority: input.priority } : {}),
      ...(copied ?? {}),
    })
    .returning();
  // Provenance, written once and never again (CTR-004): who made this
  // record survives every later owner change. It is part of creation, so
  // `contract.created` records it — no separate team row for something
  // nobody chose.
  await tx.insert(contractTeam).values({
    contractId: row!.id,
    userId: actorId,
    role: CREATOR_TEAM_ROLE,
  });
  await recordActivity(tx, {
    entityType: "contract",
    entityId: row!.id,
    actorId,
    action: "contract.created",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      number: row!.number,
      title: row!.title,
      contractType: contractType.displayName,
      status: draft.displayName,
      // Which of the type's fields were answered at birth. The slugs,
      // not the values: the M9 viewer narrates what was filled, and the
      // values are on the record to be read.
      customFields: Object.keys(customFields).sort((a, b) => a.localeCompare(b)),
    },
  });
  // A record born walled off gets its own entry beside the creation one.
  // DD-014 wants every set of the flag accountable by actor and
  // timestamp, and an Administrator reading the audit log should find it
  // under the verb they filtered on rather than inside a
  // `contract.created` payload they had to know to open.
  if (isConfidential) {
    await recordActivity(tx, {
      entityType: "contract",
      entityId: row!.id,
      actorId,
      action: "contract.confidentiality_set",
      visibility: RECORD_ACTIVITY_TIER,
      payload: { number: row!.number, title: row!.title },
    });
  }
  if (matter) {
    await recordActivity(tx, {
      entityType: "contract",
      entityId: row!.id,
      actorId,
      action: "contract.matter_linked",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        number: row!.number,
        title: row!.title,
        matterNumber: matter.number,
        matterTitle: matter.title,
      },
    });
  }

  const born = {
    row: row!,
    contractTypeName: contractType.displayName,
    statusName: draft.displayName,
    stage: draft.stage,
  };
  if (!renewal) return born;

  // The other side of the deal, copied party for party with the primary
  // still primary (CTR-011). The rows are copied rather than the names
  // re-typed, so a renewal of a tripartite agreement is born with all
  // three and nobody has to find them again — and the counterparty
  // records themselves are shared, because they are the same companies.
  //
  // **Live parties only.** A party that signed the predecessor is a fact
  // of that contract and stays on it however the register changed
  // afterwards; a party nobody may add by hand today must not arrive on
  // a *new* record through a copy, or routing would be the way around
  // the rule the add route states (MTR-014's principle). The primary is
  // carried across and re-seated when the party holding it is the one
  // that left, so the invariant "a contract with parties has a primary"
  // holds at birth.
  const parties = await tx
    .select({
      counterpartyId: contractCounterparties.counterpartyId,
      isPrimary: contractCounterparties.isPrimary,
    })
    .from(contractCounterparties)
    .innerJoin(
      counterparties,
      and(
        eq(contractCounterparties.counterpartyId, counterparties.id),
        isNull(counterparties.archivedAt),
      ),
    )
    .where(eq(contractCounterparties.contractId, renewal.predecessor.id))
    .orderBy(desc(contractCounterparties.isPrimary), asc(sql`lower(${counterparties.name})`));
  if (parties.length > 0) {
    const keepsPrimary = parties.some((party) => party.isPrimary);
    await tx.insert(contractCounterparties).values(
      parties.map((party, index) => ({
        contractId: row!.id,
        counterpartyId: party.counterpartyId,
        isPrimary: keepsPrimary ? party.isPrimary : index === 0,
      })),
    );
  }

  // The link, through CTR-015's own write path so its two guards are
  // asked here exactly as they will be asked by M17's manual linking.
  // Neither can refuse this particular call — a record born a moment ago
  // has no descendants to loop through and no links to duplicate — and
  // it goes through the guarded path all the same, because the rule
  // belongs to the write and not to the caller that happens to be safe.
  //
  // The entry hangs off the record that changed, which is the new one:
  // nothing was written on the predecessor, and a feed entry on a record
  // nobody touched would be the log asserting an edit that never
  // happened. Both ends are named by number and title, so the sentence
  // survives a rename of either.
  if (renewal.vehicle === "child") {
    await setContractParent(tx, { childId: row!.id, parentId: renewal.predecessor.id });
    await recordActivity(tx, {
      entityType: "contract",
      entityId: row!.id,
      actorId,
      action: "contract.parent_set",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        number: row!.number,
        title: row!.title,
        parentNumber: renewal.predecessor.number,
        parentTitle: renewal.predecessor.title,
      },
    });
  } else {
    await linkContracts(tx, {
      fromId: row!.id,
      toId: renewal.predecessor.id,
      relationType: "renews",
    });
    await recordActivity(tx, {
      entityType: "contract",
      entityId: row!.id,
      actorId,
      action: "contract.relation_added",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        number: row!.number,
        title: row!.title,
        relationType: "renews",
        relatedNumber: renewal.predecessor.number,
        relatedTitle: renewal.predecessor.title,
      },
    });
  }
  return born;
}
