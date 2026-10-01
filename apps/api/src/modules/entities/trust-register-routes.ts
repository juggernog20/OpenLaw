// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-015's trust register API. Each write runs in one transaction: it takes the
 * Holdings advisory lock, locks the Entity row, replays the full history through
 * `END_OF_TIME`, then prunes the parties no entry names.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  entities,
  entityRegisterParties,
  entityRegisterEntryCounters,
  entityTrustEntries,
  eq,
  notExists,
  sql,
  REGISTER_PARTY_KINDS,
  TRUST_ENTRY_KINDS,
  TRUST_ROLES,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import type { ChangedFields } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { CurrencySchema } from "../../lib/currencies.js";
import { csvRow } from "../../lib/csv.js";
import { NO_ENTITY, reachedEntity, reachedEntityIds } from "../../lib/entity-access.js";
import { assertRegisterKind, lockEntityRegisters } from "../../lib/entity-register-kind.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { END_OF_TIME, todayIsoDate } from "../../lib/share-register.js";
import { replayTrustRegister } from "../../lib/trust-register.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdParams = z.object({ id: z.string().min(1).max(64) });
const EntryParams = IdParams.extend({ entryId: z.string().min(1).max(64) });
const PartyInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party"), partyId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("entity"), entityId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("individual"), name: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal("class"), description: z.string().trim().min(1).max(2000) }),
]);
const EntryBody = z
  .strictObject({
    kind: z.enum(TRUST_ENTRY_KINDS),
    effectiveOn: z.iso.date(),
    party: PartyInput,
    role: z.enum(TRUST_ROLES).nullable().optional(),
    roleLabel: z.string().trim().min(1).max(200).nullable().optional(),
    interest: z.string().trim().max(2000).nullable().optional(),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    currency: CurrencySchema.nullable().optional(),
    property: z.string().trim().min(1).max(2000).nullable().optional(),
    reference: z.string().trim().max(200).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((body, ctx) => {
    const roleEntry = body.kind === "appointment" || body.kind === "cessation";
    const money = body.amount != null && body.currency != null && body.property == null;
    const property = body.amount == null && body.currency == null && body.property != null;
    if (
      roleEntry
        ? body.role == null || body.amount != null || body.currency != null || body.property != null
        : body.role != null || (!money && !property)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Appointments and cessations require a role; settlements and distributions require money with a currency or property, exclusively.",
      });
    if (body.role === "other" ? body.roleLabel == null : body.roleLabel != null)
      ctx.addIssue({
        code: "custom",
        path: ["roleLabel"],
        message: "Only the other role requires a label.",
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
const RoleRow = z.object({
  party: PartyRef,
  role: z.enum(TRUST_ROLES),
  roleLabel: z.string().nullable(),
  interest: z.string().nullable(),
  since: z.iso.date(),
  until: z.iso.date().nullable(),
  open: z.boolean(),
  openToday: z.boolean(),
});
const FundRow = z.object({
  currency: z.string(),
  settled: z.number().int(),
  distributed: z.number().int(),
  balance: z.number().int(),
});
const Envelope = z.object({
  asOf: z.iso.date(),
  today: z.iso.date(),
  parties: z.array(RoleRow),
  partiesToday: z.array(RoleRow),
  entries: z.array(
    z.object({
      id: z.string(),
      entryNo: z.number().int(),
      kind: z.enum(TRUST_ENTRY_KINDS),
      effectiveOn: z.iso.date(),
      party: PartyRef,
      role: z.enum(TRUST_ROLES).nullable(),
      roleLabel: z.string().nullable(),
      interest: z.string().nullable(),
      amount: z.number().int().nullable(),
      currency: z.string().nullable(),
      property: z.string().nullable(),
      reference: z.string().nullable(),
      note: z.string().nullable(),
      applied: z.boolean(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  fund: z.array(FundRow),
  dates: z.array(z.iso.date()),
  warnings: z.array(
    z.object({ code: z.literal("fund-negative"), currency: z.string(), balance: z.number().int() }),
  ),
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
    .from(entityTrustEntries)
    .where(eq(entityTrustEntries.entityId, entityId))
    .orderBy(asc(entityTrustEntries.effectiveOn), asc(entityTrustEntries.entryNo));
type Entry = Awaited<ReturnType<typeof readEntries>>[number];
async function readRegister(db: Executor, user: AuthenticatedUser, entityId: string, asOf: string) {
  const [parties, entries] = await Promise.all([
    readParties(db, entityId),
    readEntries(db, entityId),
  ]);
  const visible = await reachedEntityIds(
    db,
    user,
    parties.map((p) => p.partyEntityId),
  );
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
  const today = todayIsoDate();
  const at = replayTrustRegister({ parties, entries }, asOf);
  const now = replayTrustRegister({ parties, entries }, today);
  const roleRow = (r: (typeof at.roles)[number]) => ({
    party: refs.get(r.partyId)!,
    role: r.role,
    roleLabel: r.roleLabel,
    interest: r.interest,
    since: r.since,
    until: r.until,
    open: r.open,
    openToday: now.roles.some(
      (n) => n.partyId === r.partyId && n.role === r.role && n.roleLabel === r.roleLabel && n.open,
    ),
  });
  return {
    asOf,
    today,
    parties: at.roles.map(roleRow),
    partiesToday: now.roles.filter((r) => r.open).map(roleRow),
    entries: entries.map((e) => ({
      id: e.id,
      entryNo: e.entryNo,
      kind: e.kind,
      effectiveOn: e.effectiveOn,
      party: refs.get(e.partyId)!,
      role: e.role,
      roleLabel: e.roleLabel,
      interest: e.interest,
      amount: e.amount,
      currency: e.currency,
      property: e.property,
      reference: e.reference,
      note: e.note,
      applied: e.effectiveOn <= asOf,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
    fund: at.fund,
    dates: [...new Set(entries.map((e) => e.effectiveOn))],
    warnings: at.warnings,
  };
}

export async function getEntityTrustRegister(
  db: Executor,
  user: AuthenticatedUser,
  entityId: string,
  asOf = todayIsoDate(),
) {
  const entity = await reachedEntity(db, user, entityId);
  if (!entity) throw httpError(404, NO_ENTITY);
  await assertRegisterKind(db, entity, "trust");
  return readRegister(db, user, entityId, asOf);
}

async function editable(tx: Transaction, user: AuthenticatedUser, entityId: string) {
  await lockEntityRegisters(tx);
  const entity = await reachedEntity(tx, user, entityId, { lock: true });
  if (!entity) throw httpError(404, NO_ENTITY);
  await assertRegisterKind(tx, entity, "trust");
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
    if (input.entityId === entityId)
      throw httpError(400, "A trust cannot be a party on its own register.");
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
      description: input.kind === "class" ? input.description : null,
    })
    .returning();
  return (await readParties(tx, entityId)).find((p) => p.id === created!.id)!;
}
function values(body: EntryInput, partyId: string) {
  return {
    kind: body.kind,
    effectiveOn: body.effectiveOn,
    partyId,
    role: body.role ?? null,
    roleLabel: body.roleLabel ?? null,
    interest: body.interest || null,
    amount: body.amount ?? null,
    currency: body.currency ?? null,
    property: body.property ?? null,
    reference: body.reference || null,
    note: body.note || null,
  };
}
async function validateAndPrune(tx: Transaction, entityId: string) {
  const [parties, entries] = await Promise.all([
    readParties(tx, entityId),
    readEntries(tx, entityId),
  ]);
  const replay = replayTrustRegister({ parties, entries }, END_OF_TIME);
  if (replay.violation) throw httpError(409, replay.violation.detail);
  await tx.delete(entityRegisterParties).where(
    and(
      eq(entityRegisterParties.entityId, entityId),
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
async function activity(
  tx: Transaction,
  user: AuthenticatedUser,
  entity: { id: string; legalName: string },
  action:
    "entity_trust_entry.created" | "entity_trust_entry.updated" | "entity_trust_entry.deleted",
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
        trustId: entity.id,
        trustName: entity.legalName,
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
    .from(entityTrustEntries)
    .where(and(eq(entityTrustEntries.entityId, entityId), eq(entityTrustEntries.id, entryId)));
  if (!entry) throw httpError(404, "No trust entry exists with this id.");
  return entry;
}
const csvParty = (p: z.infer<typeof PartyRef>) => (p.restricted ? "Restricted Entity" : p.name);

export const entityTrustRegisterRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/:id/trust-register",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getEntityTrustRegister",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({ asOf: z.iso.date().optional() }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    (request) =>
      getEntityTrustRegister(app.db, request.user, request.params.id, request.query.asOf),
  );
  app.get(
    "/entities/:id/trust-register/export",
    {
      preHandler: requireMember,
      schema: {
        operationId: "exportEntityTrustRegister",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({
          kind: z.enum(["parties", "entries"]),
          asOf: z.iso.date().optional(),
        }),
        response: { 200: z.string(), default: problemResponse },
      },
    },
    async (request, reply) => {
      const register = await getEntityTrustRegister(
        app.db,
        request.user,
        request.params.id,
        request.query.asOf,
      );
      const rows =
        request.query.kind === "parties"
          ? [
              csvRow([
                "Party",
                "Party kind",
                "Role",
                "Role label",
                "Interest or powers",
                "Since",
                "Until",
              ]),
              ...register.parties.map((r) =>
                csvRow([
                  csvParty(r.party),
                  r.party.restricted ? "" : r.party.kind,
                  r.role,
                  r.roleLabel,
                  r.interest,
                  r.since,
                  r.until,
                ]),
              ),
            ]
          : [
              csvRow([
                "Entry",
                "Effective date",
                "Kind",
                "Party",
                "Role",
                "Role label",
                "Interest or powers",
                "Amount (minor units)",
                "Currency",
                "Property",
                "Reference",
                "Note",
              ]),
              ...register.entries.map((e) =>
                csvRow([
                  e.entryNo,
                  e.effectiveOn,
                  e.kind,
                  csvParty(e.party),
                  e.role,
                  e.roleLabel,
                  e.interest,
                  e.amount,
                  e.currency,
                  e.property,
                  e.reference,
                  e.note,
                ]),
              ),
            ];
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="trust ${request.query.kind} ${register.asOf}.csv"`,
        )
        .send("﻿" + rows.join(""));
    },
  );
  app.post(
    "/entities/:id/trust-entries",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityTrustEntry",
        tags: ["entities"],
        params: IdParams,
        body: EntryBody,
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const result = await app.db.transaction(async (tx) => {
        const entity = await editable(tx, request.user, request.params.id);
        const party = await resolveParty(tx, request.user, entity.id, request.body.party);
        const [counter] = await tx
          .insert(entityRegisterEntryCounters)
          .values({ entityId: entity.id, register: "trust", lastEntryNo: 1 })
          .onConflictDoUpdate({
            target: [entityRegisterEntryCounters.entityId, entityRegisterEntryCounters.register],
            set: { lastEntryNo: sql`${entityRegisterEntryCounters.lastEntryNo} + 1` },
          })
          .returning();
        const [entry] = await tx
          .insert(entityTrustEntries)
          .values({
            ...values(request.body, party.id),
            entityId: entity.id,
            entryNo: counter!.lastEntryNo,
            recordedBy: request.user.id,
          })
          .returning();
        await validateAndPrune(tx, entity.id);
        await activity(tx, request.user, entity, "entity_trust_entry.created", entry!, [party]);
        return readRegister(tx, request.user, entity.id, todayIsoDate());
      });
      return reply.status(201).send(result);
    },
  );
  app.patch(
    "/entities/:id/trust-entries/:entryId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityTrustEntry",
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
        const beforeParty = (await readParties(tx, entity.id)).find(
          (p) => p.id === current.partyId,
        )!;
        const party = await resolveParty(tx, request.user, entity.id, request.body.party);
        if (
          beforeParty.partyEntityId &&
          party.id !== beforeParty.id &&
          !(await reachedEntity(tx, request.user, beforeParty.partyEntityId))
        )
          throw httpError(409, "Keep the party you cannot see when editing this entry.");
        const next = values(request.body, party.id);
        const [updated] = await tx
          .update(entityTrustEntries)
          .set(next)
          .where(eq(entityTrustEntries.id, current.id))
          .returning();
        await validateAndPrune(tx, entity.id);
        const changed: ChangedFields = {};
        for (const key of Object.keys(next) as (keyof typeof next)[])
          if (current[key] !== next[key]) changed[key] = { from: current[key], to: next[key] };
        await activity(
          tx,
          request.user,
          entity,
          "entity_trust_entry.updated",
          updated!,
          [beforeParty, party],
          changed,
        );
        return readRegister(tx, request.user, entity.id, todayIsoDate());
      }),
  );
  app.delete(
    "/entities/:id/trust-entries/:entryId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityTrustEntry",
        tags: ["entities"],
        params: EntryParams,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const entity = await editable(tx, request.user, request.params.id);
        const current = await existingEntry(tx, entity.id, request.params.entryId);
        const party = (await readParties(tx, entity.id)).find((p) => p.id === current.partyId)!;
        await tx.delete(entityTrustEntries).where(eq(entityTrustEntries.id, current.id));
        await validateAndPrune(tx, entity.id);
        await activity(tx, request.user, entity, "entity_trust_entry.deleted", current, [party]);
      });
      return reply.status(204).send(null);
    },
  );
};
