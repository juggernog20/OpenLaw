// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-014 projects today's partners by the Entity's ownership basis. Individual
 * Holdings are matched by registerPartyId, regardless of their displayed names.
 */

import {
  entities,
  entityPartnershipEntries,
  entityRegisterParties,
  eq,
  type Transaction,
  type PartnershipBasis,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";
import { lockEntityRegisters } from "./entity-register-kind.js";
import { rewriteRegisterHoldings } from "./holdings-projection.js";
import { assertProjectionAcyclic } from "./ownership-cycle.js";
import { replayPartnershipRegister } from "./partnership-register.js";
import { todayIsoDate } from "./share-register.js";

/** Callers acquire the Holdings lock before locking Entity rows. */
export async function projectPartnershipHoldings(
  tx: Transaction,
  user: AuthenticatedUser,
  issuer: { id: string; legalName: string; partnershipBasis: PartnershipBasis },
) {
  await lockEntityRegisters(tx);
  const [parties, entries] = await Promise.all([
    tx
      .select({
        id: entityRegisterParties.id,
        kind: entityRegisterParties.kind,
        name: entityRegisterParties.name,
        partyEntityId: entityRegisterParties.partyEntityId,
        entityName: entities.legalName,
      })
      .from(entityRegisterParties)
      .leftJoin(entities, eq(entities.id, entityRegisterParties.partyEntityId))
      .where(eq(entityRegisterParties.entityId, issuer.id)),
    tx
      .select()
      .from(entityPartnershipEntries)
      .where(eq(entityPartnershipEntries.entityId, issuer.id)),
  ]);
  const state = replayPartnershipRegister(
    { parties, entries },
    todayIsoDate(),
    issuer.partnershipBasis,
  );
  const wanted = new Map<
    string,
    { holderId: string; holderEntityId: string | null; name: string; percent: number }
  >();
  for (const partner of state.partners) {
    const held =
      issuer.partnershipBasis === "capital"
        ? partner.unreturned > 0
        : issuer.partnershipBasis === "units"
          ? partner.units > 0
          : issuer.partnershipBasis === "stated"
            ? partner.statedPercent > 0
            : partner.status === "admitted";
    if (!held) continue;
    const party = parties.find((p) => p.id === partner.partyId)!;
    wanted.set(party.id, {
      holderId: party.id,
      holderEntityId: party.partyEntityId,
      name: party.entityName ?? party.name ?? "",
      percent: partner.percent,
    });
  }
  await rewriteRegisterHoldings(tx, user.id, issuer, wanted, "registerPartyId");
  await assertProjectionAcyclic(tx, user, issuer.id);
}
