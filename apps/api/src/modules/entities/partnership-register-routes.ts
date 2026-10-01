// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-014's partnership register API. Writes take the Holdings lock, validate
 * the full history, project today's Holdings, then prune parties in one transaction.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  entities,
  PARTNERSHIP_BASES,
  entityRegisterParties,
  entityRegisterEntryCounters,
  entityPartnershipEntries,
  entityTrustEntries,
  notExists,
  or,
  eq,
  sql,
  REGISTER_PARTY_KINDS,
  PARTNERSHIP_ENTRY_KINDS,
  PARTNERSHIP_CAPACITIES,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import type { ChangedFields } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { CurrencySchema } from "../../lib/currencies.js";
import { csvRow } from "../../lib/csv.js";
import { entityReachScope, NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { assertRegisterKind, lockEntityRegisters } from "../../lib/entity-register-kind.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { END_OF_TIME, todayIsoDate } from "../../lib/share-register.js";
import { assertNoRegisterCycle } from "../../lib/ownership-cycle.js";
import { projectPartnershipHoldings } from "../../lib/partnership-projection.js";
import { replayPartnershipRegister } from "../../lib/partnership-register.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdParams = z.object({ id: z.string().min(1).max(64) });
const EntryParams = IdParams.extend({ entryId: z.string().min(1).max(64) });
const PartyInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party"), partyId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("entity"), entityId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("individual"), name: z.string().trim().min(1).max(200) }),
]);
const EntryBody = z
  .strictObject({
    kind: z.enum(PARTNERSHIP_ENTRY_KINDS),
    effectiveOn: z.iso.date(),
    party: PartyInput.nullable().optional(),
    fromParty: PartyInput.nullable().optional(),
    toParty: PartyInput.nullable().optional(),
    capacity: z.enum(PARTNERSHIP_CAPACITIES).nullable().optional(),
    transfereeStatus: z.enum(["admitted", "assignee"]).nullable().optional(),
    units: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    statedPercent: z.number().min(0).max(100).multipleOf(0.01).nullable().optional(),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    currency: CurrencySchema.nullable().optional(),
    formOfContribution: z.string().trim().min(1).max(2000).nullable().optional(),
    consideration: z.string().trim().min(1).max(2000).nullable().optional(),
    reference: z.string().trim().max(200).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((b, ctx) => {
    const transfer = b.kind === "transfer";
    const money = ["commitment", "contribution", "return"].includes(b.kind);
    const shape = transfer
      ? b.party == null && b.fromParty != null && b.toParty != null
      : b.party != null && b.fromParty == null && b.toParty == null;
    const capacity =
      b.kind === "admission" ||
      b.kind === "capacity_change" ||
      (transfer && b.transfereeStatus === "admitted");
    if (
      !shape ||
      (capacity ? b.capacity == null : b.capacity != null) ||
      (!transfer && b.transfereeStatus != null) ||
      (b.amount == null) !== (b.currency == null) ||
      (money ? b.amount == null : !transfer && b.amount != null) ||
      (b.kind !== "admission" && !transfer && (b.units != null || b.statedPercent != null)) ||
      (transfer && !((b.units ?? 0) > 0 || (b.statedPercent ?? 0) > 0 || b.amount != null)) ||
      (b.formOfContribution != null && b.kind !== "contribution") ||
      (b.consideration != null && !transfer)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The entry fields do not match its kind. Admissions and capacity changes require capacity; money requires amount and currency; transfers require from and to parties and a positive balance to move.",
      });
  });
type EntryInput = z.infer<typeof EntryBody>;
const PartyRef = z.discriminatedUnion("restricted", [
  z.object({ restricted: z.literal(true), id: z.string() }),
  z.object({
    restricted: z.literal(false),
    id: z.string(),
    kind: z.enum(REGISTER_PARTY_KINDS),
    name: z.string(),
    entityId: z.string().nullable(),
  }),
]);
const Totals = z.object({
  units: z.number(),
  statedPercent: z.number(),
  committed: z.number(),
  contributed: z.number(),
  returned: z.number(),
  unreturned: z.number(),
});
const PartnerRow = Totals.extend({
  party: PartyRef,
  capacity: z.enum(PARTNERSHIP_CAPACITIES).nullable(),
  status: z.enum(["admitted", "assignee", "ceased"]),
  since: z.iso.date().nullable(),
  transferred: z.number(),
  percent: z.number(),
});
const Envelope = z.object({
  asOf: z.iso.date(),
  today: z.iso.date(),
  basis: z.enum(PARTNERSHIP_BASES),
  currency: z.string().nullable(),
  partners: z.array(PartnerRow),
  partnersToday: z.array(PartnerRow),
  totals: Totals,
  totalsToday: Totals,
  entries: z.array(
    z.object({
      id: z.string(),
      entryNo: z.number().int(),
      kind: z.enum(PARTNERSHIP_ENTRY_KINDS),
      effectiveOn: z.iso.date(),
      party: PartyRef.nullable(),
      fromParty: PartyRef.nullable(),
      toParty: PartyRef.nullable(),
      capacity: z.enum(PARTNERSHIP_CAPACITIES).nullable(),
      transfereeStatus: z.enum(["admitted", "assignee"]).nullable(),
      units: z.number().nullable(),
      statedPercent: z.number().nullable(),
      amount: z.number().nullable(),
      currency: z.string().nullable(),
      formOfContribution: z.string().nullable(),
      consideration: z.string().nullable(),
      reference: z.string().nullable(),
      note: z.string().nullable(),
      applied: z.boolean(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  dates: z.array(z.iso.date()),
  warnings: z.array(z.object({ code: z.literal("stated-total"), total: z.number() })),
});

async function readParties(db: Executor, entityId: string) {
  return db
    .select({
      id: entityRegisterParties.id,
      kind: entityRegisterParties.kind,
      partyEntityId: entityRegisterParties.partyEntityId,
      name: entityRegisterParties.name,
      description: entityRegisterParties.description,
      entityName: entities.legalName,
    })
    .from(entityRegisterParties)
    .leftJoin(entities, eq(entityRegisterParties.partyEntityId, entities.id))
    .where(eq(entityRegisterParties.entityId, entityId));
}
type Party = Awaited<ReturnType<typeof readParties>>[number];
const readEntries = (db: Executor, entityId: string) =>
  db
    .select()
    .from(entityPartnershipEntries)
    .where(eq(entityPartnershipEntries.entityId, entityId))
    .orderBy(asc(entityPartnershipEntries.effectiveOn), asc(entityPartnershipEntries.entryNo));
type Entry = Awaited<ReturnType<typeof readEntries>>[number];
async function readRegister(db: Executor, user: AuthenticatedUser, entityId: string, asOf: string) {
  const [parties, entries, reached] = await Promise.all([
    readParties(db, entityId),
    readEntries(db, entityId),
    db.select({ id: entities.id }).from(entities).where(entityReachScope(db, user)),
  ]);
  const visible = new Set(reached.map((row) => row.id));
  const refs = new Map(
    parties.map((p) => [
      p.id,
      p.partyEntityId && !visible.has(p.partyEntityId)
        ? { restricted: true as const, id: p.id }
        : {
            restricted: false as const,
            id: p.id,
            kind: p.kind,
            name: p.entityName ?? p.name ?? p.description ?? "",
            entityId: p.partyEntityId,
          },
    ]),
  );
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  const basis = entity!.partnershipBasis;
  const today = todayIsoDate();
  const at = replayPartnershipRegister({ parties, entries }, asOf, basis);
  const now = replayPartnershipRegister({ parties, entries }, today, basis);
  const partnerRow = (p: (typeof at.partners)[number]) => {
    const { partyId, ...rest } = p;
    return { ...rest, party: refs.get(partyId)! };
  };
  return {
    asOf,
    today,
    basis,
    currency: at.currency,
    partners: at.partners.map(partnerRow),
    partnersToday: now.partners.map(partnerRow),
    totals: at.totals,
    totalsToday: now.totals,
    warnings: now.warnings,
    dates: [...new Set(entries.map((e) => e.effectiveOn))],
    entries: entries.map((e) => ({
      id: e.id,
      entryNo: e.entryNo,
      kind: e.kind,
      effectiveOn: e.effectiveOn,
      party: e.partyId ? refs.get(e.partyId)! : null,
      fromParty: e.fromPartyId ? refs.get(e.fromPartyId)! : null,
      toParty: e.toPartyId ? refs.get(e.toPartyId)! : null,
      capacity: e.capacity,
      transfereeStatus: e.transfereeStatus,
      units: e.units,
      statedPercent: e.statedPercent === null ? null : Number(e.statedPercent),
      amount: e.amount,
      currency: e.currency,
      formOfContribution: e.formOfContribution,
      consideration: e.consideration,
      reference: e.reference,
      note: e.note,
      applied: e.effectiveOn <= asOf,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
  };
}

export async function getEntityPartnershipRegister(
  db: Executor,
  user: AuthenticatedUser,
  entityId: string,
  asOf = todayIsoDate(),
) {
  const entity = await reachedEntity(db, user, entityId);
  if (!entity) throw httpError(404, NO_ENTITY);
  await assertRegisterKind(db, entity, "partnership");
  return readRegister(db, user, entityId, asOf);
}

async function editable(tx: Transaction, user: AuthenticatedUser, entityId: string) {
  await lockEntityRegisters(tx);
  const entity = await reachedEntity(tx, user, entityId, { lock: true });
  if (!entity) throw httpError(404, NO_ENTITY);
  await assertRegisterKind(tx, entity, "partnership");
  if (entity.archivedAt)
    throw httpError(409, "This Entity is archived. Restore it before changing its register.");
  return entity;
}
async function resolveParty(
  tx: Transaction,
  user: AuthenticatedUser,
  entityId: string,
  input: z.infer<typeof PartyInput>,
) {
  const parties = await readParties(tx, entityId);
  if (input.kind === "party") {
    const party = parties.find((p) => p.id === input.partyId);
    if (!party) throw httpError(400, "Pick a party from this register.");
    return party;
  }
  if (input.kind === "entity") {
    if (input.entityId === entityId) throw httpError(409, "A partnership cannot own itself.");
    const related = await reachedEntity(tx, user, input.entityId, { lock: true });
    if (!related || related.archivedAt)
      throw httpError(400, "Pick a live Entity from the registry.");
    const existing = parties.find((p) => p.partyEntityId === input.entityId);
    if (existing) return existing;
  }
  const [created] = await tx
    .insert(entityRegisterParties)
    .values({
      entityId,
      kind: input.kind,
      partyEntityId: input.kind === "entity" ? input.entityId : null,
      name: input.kind === "individual" ? input.name : null,
      description: null,
    })
    .returning();
  return (await readParties(tx, entityId)).find((p) => p.id === created!.id)!;
}
async function resolveEntryParties(
  tx: Transaction,
  user: AuthenticatedUser,
  entityId: string,
  body: EntryInput,
) {
  const party = body.party ? await resolveParty(tx, user, entityId, body.party) : null;
  const from = body.fromParty ? await resolveParty(tx, user, entityId, body.fromParty) : null;
  const to = body.toParty ? await resolveParty(tx, user, entityId, body.toParty) : null;
  if (from && to && from.id === to.id)
    throw httpError(409, "A transfer requires two different parties.");
  return { party, from, to };
}
function values(body: EntryInput, parties: Awaited<ReturnType<typeof resolveEntryParties>>) {
  return {
    kind: body.kind,
    effectiveOn: body.effectiveOn,
    partyId: parties.party?.id ?? null,
    fromPartyId: parties.from?.id ?? null,
    toPartyId: parties.to?.id ?? null,
    capacity: body.capacity ?? null,
    transfereeStatus: body.transfereeStatus ?? null,
    units: body.units ?? null,
    statedPercent: body.statedPercent == null ? null : body.statedPercent.toFixed(2),
    amount: body.amount ?? null,
    currency: body.currency ?? null,
    formOfContribution: body.formOfContribution ?? null,
    consideration: body.consideration ?? null,
    reference: body.reference || null,
    note: body.note || null,
  };
}
async function validateAndProject(
  tx: Transaction,
  user: AuthenticatedUser,
  entity: Awaited<ReturnType<typeof editable>>,
  candidate?: Entry,
) {
  const entityId = entity.id;
  const [parties, entries] = await Promise.all([
    readParties(tx, entityId),
    readEntries(tx, entityId),
  ]);
  const replay = replayPartnershipRegister(
    { parties, entries },
    END_OF_TIME,
    entity.partnershipBasis,
  );
  if (replay.violation) throw httpError(409, replay.violation.detail);
  // Delete stale Holdings, with their Activity, before pruning their party FK.
  await projectPartnershipHoldings(tx, user, entity);
  if (candidate?.kind === "admission" || candidate?.kind === "transfer") {
    for (const party of namedParties(candidate, parties))
      if (party.partyEntityId) await assertNoRegisterCycle(tx, user, party.partyEntityId, entityId);
  }
  await tx.delete(entityRegisterParties).where(
    and(
      eq(entityRegisterParties.entityId, entityId),
      notExists(
        tx
          .select({ id: entityPartnershipEntries.id })
          .from(entityPartnershipEntries)
          .where(
            and(
              eq(entityPartnershipEntries.entityId, entityId),
              or(
                eq(entityPartnershipEntries.partyId, entityRegisterParties.id),
                eq(entityPartnershipEntries.fromPartyId, entityRegisterParties.id),
                eq(entityPartnershipEntries.toPartyId, entityRegisterParties.id),
              ),
            ),
          ),
      ),
      notExists(
        tx
          .select({ id: entityTrustEntries.id })
          .from(entityTrustEntries)
          .where(
            and(
              eq(entityTrustEntries.entityId, entityId),
              eq(entityTrustEntries.partyId, entityRegisterParties.id),
            ),
          ),
      ),
    ),
  );
}
const namedParties = (entry: Entry, parties: Party[]) =>
  parties.filter((p) => [entry.partyId, entry.fromPartyId, entry.toPartyId].includes(p.id));
async function activity(
  tx: Transaction,
  user: AuthenticatedUser,
  entity: { id: string; legalName: string },
  action:
    | "entity_partnership_entry.created"
    | "entity_partnership_entry.updated"
    | "entity_partnership_entry.deleted",
  entry: Entry,
  parties: Party[],
  changed: ChangedFields = {},
) {
  const targets = new Map([[entity.id, entity.legalName]]);
  for (const party of parties)
    if (party.partyEntityId && party.entityName) targets.set(party.partyEntityId, party.entityName);
  for (const [entityId, legalName] of targets) {
    await recordActivity(tx, {
      entityType: "entity",
      entityId,
      actorId: user.id,
      visibility: "legal_only",
      action,
      payload: {
        legalName,
        partnershipId: entity.id,
        partnershipName: entity.legalName,
        entryNo: entry.entryNo,
        kind: entry.kind,
        effectiveOn: entry.effectiveOn,
        changed,
      },
    });
  }
}
async function existingEntry(tx: Transaction, entityId: string, entryId: string) {
  const [entry] = await tx
    .select()
    .from(entityPartnershipEntries)
    .where(
      and(
        eq(entityPartnershipEntries.entityId, entityId),
        eq(entityPartnershipEntries.id, entryId),
      ),
    );
  if (!entry) throw httpError(404, "No partnership entry exists with this id.");
  return entry;
}
const csvParty = (p: z.infer<typeof PartyRef> | null) =>
  p === null ? "" : p.restricted ? "Restricted Entity" : p.name;

export const entityPartnershipRegisterRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/:id/partnership-register",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getEntityPartnershipRegister",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({ asOf: z.iso.date().optional() }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    (request) =>
      getEntityPartnershipRegister(app.db, request.user, request.params.id, request.query.asOf),
  );
  app.get(
    "/entities/:id/partnership-register/export",
    {
      preHandler: requireMember,
      schema: {
        operationId: "exportEntityPartnershipRegister",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({
          kind: z.enum(["partners", "entries"]),
          asOf: z.iso.date().optional(),
        }),
        response: { 200: z.string(), default: problemResponse },
      },
    },
    async (request, reply) => {
      const register = await getEntityPartnershipRegister(
        app.db,
        request.user,
        request.params.id,
        request.query.asOf,
      );
      const rows =
        request.query.kind === "partners"
          ? [
              csvRow([
                "Partner",
                "Capacity",
                "Status",
                "Since",
                "Units",
                "Stated percent",
                "Committed (minor units)",
                "Contributed (minor units)",
                "Returned (minor units)",
                "Transferred (minor units)",
                "Unreturned (minor units)",
                "Currency",
                "Percent",
                "Basis",
              ]),
              ...register.partners.map((p) =>
                csvRow([
                  csvParty(p.party),
                  p.capacity,
                  p.status,
                  p.since,
                  p.units,
                  p.statedPercent,
                  p.committed,
                  p.contributed,
                  p.returned,
                  p.transferred,
                  p.unreturned,
                  register.currency,
                  p.percent,
                  register.basis,
                ]),
              ),
            ]
          : [
              csvRow([
                "Entry",
                "Effective date",
                "Kind",
                "Party",
                "From",
                "To",
                "Capacity",
                "Transferee status",
                "Units",
                "Stated percent",
                "Amount (minor units)",
                "Currency",
                "Form of contribution",
                "Consideration",
                "Reference",
                "Note",
              ]),
              ...register.entries.map((e) =>
                csvRow([
                  e.entryNo,
                  e.effectiveOn,
                  e.kind,
                  csvParty(e.party),
                  csvParty(e.fromParty),
                  csvParty(e.toParty),
                  e.capacity,
                  e.transfereeStatus,
                  e.units,
                  e.statedPercent,
                  e.amount,
                  e.currency,
                  e.formOfContribution,
                  e.consideration,
                  e.reference,
                  e.note,
                ]),
              ),
            ];
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="partnership ${request.query.kind} ${register.asOf}.csv"`,
        )
        .send("﻿" + rows.join(""));
    },
  );
  app.post(
    "/entities/:id/partnership-entries",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityPartnershipEntry",
        tags: ["entities"],
        params: IdParams,
        body: EntryBody,
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const result = await app.db.transaction(async (tx) => {
        const entity = await editable(tx, request.user, request.params.id);
        const resolved = await resolveEntryParties(tx, request.user, entity.id, request.body);
        const [counter] = await tx
          .insert(entityRegisterEntryCounters)
          .values({ entityId: entity.id, register: "partnership", lastEntryNo: 1 })
          .onConflictDoUpdate({
            target: [entityRegisterEntryCounters.entityId, entityRegisterEntryCounters.register],
            set: { lastEntryNo: sql`${entityRegisterEntryCounters.lastEntryNo} + 1` },
          })
          .returning();
        const [entry] = await tx
          .insert(entityPartnershipEntries)
          .values({
            ...values(request.body, resolved),
            entityId: entity.id,
            entryNo: counter!.lastEntryNo,
            recordedBy: request.user.id,
          })
          .returning();
        await validateAndProject(tx, request.user, entity, entry!);
        await activity(
          tx,
          request.user,
          entity,
          "entity_partnership_entry.created",
          entry!,
          Object.values(resolved).filter((p): p is Party => p !== null),
        );
        return readRegister(tx, request.user, entity.id, todayIsoDate());
      });
      return reply.status(201).send(result);
    },
  );
  app.patch(
    "/entities/:id/partnership-entries/:entryId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityPartnershipEntry",
        tags: ["entities"],
        params: EntryParams,
        body: EntryBody,
        response: { 200: Envelope, default: problemResponse },
      },
    },
    (request) =>
      app.db.transaction(async (tx) => {
        const entity = await editable(tx, request.user, request.params.id);
        const current = await existingEntry(tx, entity.id, request.params.entryId);
        const beforeParties = namedParties(current, await readParties(tx, entity.id));
        const resolved = await resolveEntryParties(tx, request.user, entity.id, request.body);
        const afterParties = Object.values(resolved).filter((p): p is Party => p !== null);
        for (const before of beforeParties)
          if (
            before.partyEntityId &&
            !afterParties.some((p) => p.id === before.id) &&
            !(await reachedEntity(tx, request.user, before.partyEntityId))
          )
            throw httpError(409, "Keep the party you cannot see when editing this entry.");
        const next = values(request.body, resolved);
        const [updated] = await tx
          .update(entityPartnershipEntries)
          .set(next)
          .where(eq(entityPartnershipEntries.id, current.id))
          .returning();
        await validateAndProject(tx, request.user, entity, updated!);
        const changed: ChangedFields = {};
        for (const key of Object.keys(next) as (keyof typeof next)[])
          if (current[key] !== next[key]) changed[key] = { from: current[key], to: next[key] };
        await activity(
          tx,
          request.user,
          entity,
          "entity_partnership_entry.updated",
          updated!,
          [...beforeParties, ...afterParties],
          changed,
        );
        return readRegister(tx, request.user, entity.id, todayIsoDate());
      }),
  );
  app.delete(
    "/entities/:id/partnership-entries/:entryId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityPartnershipEntry",
        tags: ["entities"],
        params: EntryParams,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const entity = await editable(tx, request.user, request.params.id);
        const current = await existingEntry(tx, entity.id, request.params.entryId);
        const parties = namedParties(current, await readParties(tx, entity.id));
        await tx
          .delete(entityPartnershipEntries)
          .where(eq(entityPartnershipEntries.id, current.id));
        await validateAndProject(tx, request.user, entity);
        await activity(
          tx,
          request.user,
          entity,
          "entity_partnership_entry.deleted",
          current,
          parties,
        );
      });
      return reply.status(204).send(null);
    },
  );
};
