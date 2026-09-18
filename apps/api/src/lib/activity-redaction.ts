// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The far side of a link, taken out of a payload the viewer may read.
 *
 * A relation, a parent, a Matter link, or a Holding is narrated on the
 * record it was acted from, and the payload stores the other record's
 * number and title so the sentence reads without a join. The row is
 * append-only, so the payload keeps those names for good. The viewer's
 * projection does not: a Contract, Matter, or Entity this viewer cannot
 * reach (DD-014, ENT-004) answers 404 on its own record, and its title
 * must not come out through a neighbour's feed instead.
 *
 * One helper, applied by the activity feed, the audit log, and its CSV,
 * so the three surfaces cannot disagree about what a name leaks. It
 * strips the keys that name the far record and leaves the entry in
 * place: that something was linked is the acted-from record's own
 * history, and the viewer reaches that record.
 */
import { and, contracts, entities, inArray, matters, type Executor } from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";
import { contractTeamScope } from "./contract-access.js";
import { entityReachScope } from "./entity-access.js";
import { matterTeamScope } from "./matter-access.js";

type Payload = Record<string, unknown>;

/** What one entry names on its far side, and which keys carry it. */
interface FarReference {
  kind: "contract" | "matter" | "entity";
  /** The number of a Contract or Matter, or the legal name of an Entity. */
  identity: number | string;
  /** The payload keys that name the far record. */
  keys: readonly string[];
}

const RELATED_KEYS = ["relatedNumber", "relatedTitle"] as const;
const PARENT_KEYS = ["parentNumber", "parentTitle"] as const;
const MATTER_LINK_KEYS = ["matterNumber", "matterTitle"] as const;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);
const isString = (value: unknown): value is string => typeof value === "string";

function farReferenceOf(action: string, payload: Payload): FarReference | null {
  switch (action) {
    case "contract.relation_added":
    case "contract.relation_removed":
      return isNumber(payload.relatedNumber)
        ? { kind: "contract", identity: payload.relatedNumber, keys: RELATED_KEYS }
        : null;
    case "contract.parent_set":
    case "contract.parent_removed":
      return isNumber(payload.parentNumber)
        ? { kind: "contract", identity: payload.parentNumber, keys: PARENT_KEYS }
        : null;
    case "contract.matter_linked":
    case "contract.matter_unlinked":
      return isNumber(payload.matterNumber)
        ? { kind: "matter", identity: payload.matterNumber, keys: MATTER_LINK_KEYS }
        : null;
    case "matter.relation_added":
    case "matter.relation_removed":
      return isNumber(payload.relatedNumber)
        ? { kind: "matter", identity: payload.relatedNumber, keys: RELATED_KEYS }
        : null;
    case "matter.parent_set":
    case "matter.parent_removed":
      return isNumber(payload.parentNumber)
        ? { kind: "matter", identity: payload.parentNumber, keys: PARENT_KEYS }
        : null;
    case "entity_holding.created":
    case "entity_holding.updated":
    case "entity_holding.deleted": {
      // The entry sits on one end of the Holding and names both ends.
      // `legalName` is this end; the other name is the far side. The
      // payload carries names, not ids, so the far Entity is looked up
      // by name and a name that matches no reachable row is stripped.
      const own = payload.legalName;
      for (const key of ["ownerName", "ownedName"] as const) {
        const name = payload[key];
        if (isString(name) && name !== own) return { kind: "entity", identity: name, keys: [key] };
      }
      return null;
    }
    default:
      return null;
  }
}

function withoutKeys(payload: Payload, keys: readonly string[]): Payload {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !keys.includes(key)));
}

/**
 * Strips the far record's number and title from every entry whose far
 * record this viewer does not reach. Entries about anything else, and
 * entries whose far record the viewer reaches, come back untouched.
 * One read per record kind for the whole page, not one per row.
 */
export async function redactUnreachedReferences<T extends { action: string; payload: Payload }>(
  db: Executor,
  user: AuthenticatedUser,
  entries: readonly T[],
): Promise<T[]> {
  const references = entries.map((entry) => farReferenceOf(entry.action, entry.payload));
  const identitiesOf = <I extends number | string>(
    kind: FarReference["kind"],
    guard: (value: number | string) => value is I,
  ): I[] => [
    ...new Set(
      references.flatMap((reference) =>
        reference?.kind === kind && guard(reference.identity) ? [reference.identity] : [],
      ),
    ),
  ];
  const contractNumbers = identitiesOf("contract", isNumber);
  const matterNumbers = identitiesOf("matter", isNumber);
  const entityNames = identitiesOf("entity", isString);

  const [reachedContracts, reachedMatters, reachedEntities] = await Promise.all([
    contractNumbers.length === 0
      ? []
      : db
          .select({ number: contracts.number })
          .from(contracts)
          .where(and(inArray(contracts.number, contractNumbers), contractTeamScope(db, user))),
    matterNumbers.length === 0
      ? []
      : db
          .select({ number: matters.number })
          .from(matters)
          .where(and(inArray(matters.number, matterNumbers), matterTeamScope(db, user))),
    entityNames.length === 0
      ? []
      : db
          .select({ legalName: entities.legalName })
          .from(entities)
          .where(and(inArray(entities.legalName, entityNames), entityReachScope(db, user))),
  ]);
  const reached: Record<FarReference["kind"], Set<number | string>> = {
    contract: new Set(reachedContracts.map((row) => row.number)),
    matter: new Set(reachedMatters.map((row) => row.number)),
    entity: new Set(reachedEntities.map((row) => row.legalName)),
  };

  return entries.map((entry, index) => {
    const reference = references[index];
    if (!reference || reached[reference.kind].has(reference.identity)) return entry;
    return { ...entry, payload: withoutKeys(entry.payload, reference.keys) };
  });
}
