// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The share register at the HTTP seam (ENT-011): share classes, register
 * entries with their certificates, and the as-of read that replays them
 * into the Register of members. Holders are never written directly; a
 * holder row appears because an entry names it.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ADVISORY_LOCK,
  and,
  asc,
  entities,
  entityHoldings,
  entityShareCertificates,
  entityShareClasses,
  entityShareEntries,
  entityShareEntryCounters,
  entityShareholders,
  eq,
  inArray,
  isNull,
  SHARE_ENTRY_KINDS,
  sql,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { ENTITY_HOLDING_CYCLE_PROBLEM_TYPE, type ChangedFields } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { CurrencySchema } from "../../lib/currencies.js";
import { entityReachScope, NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { projectRegisterHoldings } from "../../lib/holdings-projection.js";
import { ownershipPath } from "../../lib/ownership-path.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  END_OF_TIME,
  orderEntries,
  replayRegister,
  todayIsoDate,
  type ReplayCertificate,
  type ReplayEntry,
} from "../../lib/share-register.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdParams = z.object({ id: z.string().min(1).max(64) });
const ClassParams = IdParams.extend({ classId: z.string().min(1).max(64) });
const EntryParams = IdParams.extend({ entryId: z.string().min(1).max(64) });
const MAX_SHARES = 1_000_000_000_000;

type User = Parameters<typeof entityReachScope>[1];

// Wire shapes

const ShareClassSchema = z.object({
  id: z.string(),
  name: z.string(),
  authorized: z.number().int().nullable(),
  parValue: z.number().int().nullable(),
  parValueCurrency: z.string().nullable(),
  votesPerShare: z.number(),
  rights: z.string().nullable(),
  position: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
  entryCount: z.number().int(),
});

const HolderRefSchema = z.discriminatedUnion("restricted", [
  z.object({
    restricted: z.literal(false),
    id: z.string(),
    kind: z.enum(["entity", "individual"]),
    name: z.string(),
    entityId: z.string().nullable(),
    jurisdiction: z.string().nullable(),
  }),
  z.object({ restricted: z.literal(true), id: z.string() }),
]);

const RegisterRowSchema = z.object({
  holder: HolderRefSchema,
  shareClassId: z.string(),
  balance: z.number().int(),
  percentOfClass: z.number(),
  percentOfVotes: z.number(),
  certificates: z.array(z.string()),
  memberSince: z.iso.date().nullable(),
  balanceToday: z.number().int(),
});

const TreasuryRowSchema = z.object({ shareClassId: z.string(), balance: z.number().int() });

const ClassTotalSchema = z.object({
  shareClassId: z.string(),
  issued: z.number().int(),
  treasury: z.number().int(),
  outstanding: z.number().int(),
  votes: z.number(),
  percentOfVotes: z.number(),
});

const EntrySchema = z.object({
  id: z.string(),
  entryNo: z.number().int(),
  kind: z.enum(SHARE_ENTRY_KINDS),
  effectiveOn: z.iso.date(),
  shareClassId: z.string(),
  toShareClassId: z.string().nullable(),
  quantity: z.number().int(),
  from: HolderRefSchema.nullable(),
  to: HolderRefSchema.nullable(),
  pricePerShare: z.number().int().nullable(),
  priceCurrency: z.string().nullable(),
  consideration: z.string().nullable(),
  distinctiveNumbers: z.string().nullable(),
  resolutionRef: z.string().nullable(),
  note: z.string().nullable(),
  certificatesIssued: z.array(
    z.object({
      number: z.string(),
      holderId: z.string(),
      shareClassId: z.string(),
      quantity: z.number().int(),
      distinctiveNumbers: z.string().nullable(),
    }),
  ),
  certificatesCancelled: z.array(z.string()),
  applied: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const WarningSchema = z.object({
  code: z.literal("authorized-exceeded"),
  shareClassId: z.string(),
  className: z.string(),
  issued: z.number().int(),
  authorized: z.number().int(),
});

const RegisterEnvelope = z.object({
  asOf: z.iso.date(),
  today: z.iso.date(),
  classes: z.array(ShareClassSchema),
  holders: z.array(RegisterRowSchema),
  treasury: z.array(TreasuryRowSchema),
  totals: z.array(ClassTotalSchema),
  entries: z.array(EntrySchema),
  dates: z.array(z.iso.date()),
  reconciliation: z.object({
    declaredIssued: z.number().int().nullable(),
    registerIssued: z.number().int(),
  }),
  warnings: z.array(WarningSchema),
});

const ShareClassBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  authorized: z.number().int().min(0).max(MAX_SHARES).nullable().optional(),
  parValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  parValueCurrency: CurrencySchema.nullable().optional(),
  votesPerShare: z.number().min(0).max(1_000_000).optional(),
  rights: z.string().trim().max(500).nullable().optional(),
});

const HolderInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("holder"), holderId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("entity"), entityId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("individual"), name: z.string().trim().min(1).max(200) }),
]);

const CertificateInput = z.strictObject({
  number: z.string().trim().min(1).max(50),
  holder: z.enum(["from", "to"]),
  quantity: z.number().int().min(1).max(MAX_SHARES),
  distinctiveNumbers: z.string().trim().max(200).nullable().optional(),
});

const EntryBody = z.strictObject({
  kind: z.enum(SHARE_ENTRY_KINDS),
  effectiveOn: z.iso.date(),
  shareClassId: z.string().min(1).max(64),
  toShareClassId: z.string().min(1).max(64).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_SHARES),
  from: HolderInput.nullable().optional(),
  to: HolderInput.nullable().optional(),
  pricePerShare: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  priceCurrency: CurrencySchema.nullable().optional(),
  consideration: z.string().trim().max(500).nullable().optional(),
  distinctiveNumbers: z.string().trim().max(200).nullable().optional(),
  resolutionRef: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  certificatesCancelled: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  certificatesIssued: z.array(CertificateInput).max(50).optional(),
});
type EntryInput = z.infer<typeof EntryBody>;

// Reads

function assertEditable(entity: { archivedAt: Date | null }) {
  if (entity.archivedAt) {
    throw httpError(409, "This entity is archived. Restore it before changing its register.");
  }
}

async function reachableIds(db: Executor, user: User) {
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(entityReachScope(db, user));
  return new Set(rows.map((row) => row.id));
}

async function readClasses(db: Executor, entityId: string) {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: entityShareClasses.id,
        name: entityShareClasses.name,
        authorized: entityShareClasses.authorized,
        parValue: entityShareClasses.parValue,
        parValueCurrency: entityShareClasses.parValueCurrency,
        votesPerShare: entityShareClasses.votesPerShare,
        rights: entityShareClasses.rights,
        position: entityShareClasses.position,
        archivedAt: entityShareClasses.archivedAt,
      })
      .from(entityShareClasses)
      .where(eq(entityShareClasses.entityId, entityId))
      .orderBy(asc(entityShareClasses.position), asc(entityShareClasses.createdAt)),
    db
      .select({
        shareClassId: entityShareEntries.shareClassId,
        toShareClassId: entityShareEntries.toShareClassId,
      })
      .from(entityShareEntries)
      .where(eq(entityShareEntries.entityId, entityId)),
  ]);
  const entryCount = new Map<string, number>();
  for (const row of counts) {
    for (const id of new Set([row.shareClassId, row.toShareClassId])) {
      if (id) entryCount.set(id, (entryCount.get(id) ?? 0) + 1);
    }
  }
  return rows.map((row) => ({
    ...row,
    votesPerShare: Number(row.votesPerShare),
    entryCount: entryCount.get(row.id) ?? 0,
  }));
}
type ClassRow = Awaited<ReturnType<typeof readClasses>>[number];

async function readHolders(db: Executor, entityId: string) {
  return db
    .select({
      id: entityShareholders.id,
      kind: entityShareholders.kind,
      name: entityShareholders.name,
      holderEntityId: entityShareholders.holderEntityId,
      entityName: entities.legalName,
      jurisdiction: entities.jurisdiction,
    })
    .from(entityShareholders)
    .leftJoin(entities, eq(entityShareholders.holderEntityId, entities.id))
    .where(eq(entityShareholders.entityId, entityId));
}
type HolderRow = Awaited<ReturnType<typeof readHolders>>[number];

function holderName(row: HolderRow) {
  return row.kind === "entity" ? (row.entityName ?? "") : (row.name ?? "");
}

function holderRef(row: HolderRow, visible: ReadonlySet<string>) {
  if (row.kind === "entity" && row.holderEntityId && !visible.has(row.holderEntityId)) {
    return { restricted: true as const, id: row.id };
  }
  return {
    restricted: false as const,
    id: row.id,
    kind: row.kind,
    name: holderName(row),
    entityId: row.holderEntityId,
    jurisdiction: row.kind === "entity" ? row.jurisdiction : null,
  };
}

async function readEntries(db: Executor, entityId: string) {
  return db
    .select()
    .from(entityShareEntries)
    .where(eq(entityShareEntries.entityId, entityId))
    .orderBy(asc(entityShareEntries.effectiveOn), asc(entityShareEntries.entryNo));
}
type EntryRow = Awaited<ReturnType<typeof readEntries>>[number];

async function readCertificates(db: Executor, entityId: string) {
  return db
    .select()
    .from(entityShareCertificates)
    .where(eq(entityShareCertificates.entityId, entityId))
    .orderBy(asc(entityShareCertificates.number));
}
type CertificateRow = Awaited<ReturnType<typeof readCertificates>>[number];

function toReplayEntry(row: EntryRow): ReplayEntry {
  return {
    id: row.id,
    entryNo: row.entryNo,
    kind: row.kind,
    effectiveOn: row.effectiveOn,
    shareClassId: row.shareClassId,
    toShareClassId: row.toShareClassId,
    quantity: row.quantity,
    fromHolderId: row.fromHolderId,
    toHolderId: row.toHolderId,
  };
}

function toReplayCertificate(row: CertificateRow): ReplayCertificate {
  return {
    id: row.id,
    number: row.number,
    holderId: row.holderId,
    shareClassId: row.shareClassId,
    quantity: row.quantity,
    issuedByEntryId: row.issuedByEntryId,
    cancelledByEntryId: row.cancelledByEntryId,
  };
}

const nameOfRef = (ref: { restricted: boolean; name?: string }) =>
  ref.restricted ? "" : (ref.name ?? "");

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0;

/** The whole register, replayed to `asOf` and to today. */
async function readRegister(
  db: Executor,
  user: User,
  entity: { id: string; sharesIssued: number | null },
  asOf: string,
) {
  const today = todayIsoDate();
  const [classes, holders, entryRows, certificateRows, visible] = await Promise.all([
    readClasses(db, entity.id),
    readHolders(db, entity.id),
    readEntries(db, entity.id),
    readCertificates(db, entity.id),
    reachableIds(db, user),
  ]);
  const input = {
    classes: classes.map((row) => ({
      id: row.id,
      authorized: row.authorized,
      votesPerShare: row.votesPerShare,
    })),
    entries: entryRows.map(toReplayEntry),
    certificates: certificateRows.map(toReplayCertificate),
  };
  const state = replayRegister(input, asOf);
  const todayState = asOf === today ? state : replayRegister(input, today);
  const holderById = new Map(holders.map((row) => [row.id, row]));
  const classById = new Map(classes.map((row) => [row.id, row]));
  const votesOf = (shareClassId: string) => classById.get(shareClassId)?.votesPerShare ?? 0;
  const totalVotes = state.balances.reduce(
    (sum, row) => sum + row.balance * votesOf(row.shareClassId),
    0,
  );
  const todayBalance = new Map(
    todayState.balances.map((row) => [`${row.holderId}:${row.shareClassId}`, row.balance]),
  );
  const liveByHolder = new Map<string, string[]>();
  for (const certificate of state.liveCertificates) {
    const k = `${certificate.holderId}:${certificate.shareClassId}`;
    const list = liveByHolder.get(k) ?? [];
    list.push(certificate.number);
    liveByHolder.set(k, list);
  }
  const classOrder = (shareClassId: string) => classById.get(shareClassId)?.position ?? 0;
  const rows = state.balances
    .map((row) => {
      const holder = holderById.get(row.holderId);
      if (!holder) return null;
      const k = `${row.holderId}:${row.shareClassId}`;
      return {
        holder: holderRef(holder, visible),
        shareClassId: row.shareClassId,
        balance: row.balance,
        percentOfClass: percent(row.balance, state.issued.get(row.shareClassId) ?? 0),
        percentOfVotes: percent(row.balance * votesOf(row.shareClassId), totalVotes),
        certificates: (liveByHolder.get(k) ?? []).sort(),
        memberSince: state.memberSince.get(row.holderId) ?? null,
        balanceToday: todayBalance.get(k) ?? 0,
      };
    })
    .filter((row) => row !== null)
    .sort(
      (a, b) =>
        classOrder(a.shareClassId) - classOrder(b.shareClassId) ||
        b.balance - a.balance ||
        nameOfRef(a.holder).localeCompare(nameOfRef(b.holder)),
    );
  const totals = classes.map((shareClass) => {
    const issued = state.issued.get(shareClass.id) ?? 0;
    const treasury = state.treasury.get(shareClass.id) ?? 0;
    const outstanding = issued - treasury;
    const votes = outstanding * shareClass.votesPerShare;
    return {
      shareClassId: shareClass.id,
      issued,
      treasury,
      outstanding,
      votes,
      percentOfVotes: percent(votes, totalVotes),
    };
  });
  const issuedByEntry = new Map<string, CertificateRow[]>();
  const cancelledByEntry = new Map<string, CertificateRow[]>();
  for (const certificate of certificateRows) {
    const issuedList = issuedByEntry.get(certificate.issuedByEntryId) ?? [];
    issuedList.push(certificate);
    issuedByEntry.set(certificate.issuedByEntryId, issuedList);
    if (certificate.cancelledByEntryId) {
      const cancelledList = cancelledByEntry.get(certificate.cancelledByEntryId) ?? [];
      cancelledList.push(certificate);
      cancelledByEntry.set(certificate.cancelledByEntryId, cancelledList);
    }
  }
  const ref = (holderId: string | null) => {
    const holder = holderId ? holderById.get(holderId) : undefined;
    return holder ? holderRef(holder, visible) : null;
  };
  const entries = orderEntries(entryRows).map((row) => ({
    id: row.id,
    entryNo: row.entryNo,
    kind: row.kind,
    effectiveOn: row.effectiveOn,
    shareClassId: row.shareClassId,
    toShareClassId: row.toShareClassId,
    quantity: row.quantity,
    from: ref(row.fromHolderId),
    to: ref(row.toHolderId),
    pricePerShare: row.pricePerShare,
    priceCurrency: row.priceCurrency,
    consideration: row.consideration,
    distinctiveNumbers: row.distinctiveNumbers,
    resolutionRef: row.resolutionRef,
    note: row.note,
    certificatesIssued: (issuedByEntry.get(row.id) ?? []).map((certificate) => ({
      number: certificate.number,
      holderId: certificate.holderId,
      shareClassId: certificate.shareClassId,
      quantity: certificate.quantity,
      distinctiveNumbers: certificate.distinctiveNumbers,
    })),
    certificatesCancelled: (cancelledByEntry.get(row.id) ?? []).map((row) => row.number),
    applied: row.effectiveOn <= asOf,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  let registerIssued = 0;
  for (const count of todayState.issued.values()) registerIssued += count;
  return {
    asOf,
    today,
    classes: classes.map((row) => ({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null })),
    holders: rows,
    treasury: [...state.treasury.entries()]
      .filter(([, balance]) => balance > 0)
      .map(([shareClassId, balance]) => ({ shareClassId, balance }))
      .sort((a, b) => classOrder(a.shareClassId) - classOrder(b.shareClassId)),
    totals,
    entries,
    dates: [...new Set(entryRows.map((row) => row.effectiveOn))].sort(),
    reconciliation: { declaredIssued: entity.sharesIssued, registerIssued },
    warnings: todayState.warnings.map((warning) => ({
      ...warning,
      className: classById.get(warning.shareClassId)?.name ?? "",
    })),
  };
}

// Writes

/** Replays the register with the change already written and refuses a broken one. */
async function assertSoundRegister(tx: Transaction, entityId: string) {
  const [classes, entryRows, certificateRows] = await Promise.all([
    readClasses(tx, entityId),
    readEntries(tx, entityId),
    readCertificates(tx, entityId),
  ]);
  const state = replayRegister(
    {
      classes: classes.map((row) => ({
        id: row.id,
        authorized: row.authorized,
        votesPerShare: row.votesPerShare,
      })),
      entries: entryRows.map(toReplayEntry),
      certificates: certificateRows.map(toReplayCertificate),
    },
    END_OF_TIME,
  );
  if (state.violation) throw httpError(409, state.violation.detail);
}

/** Drops the issuer's holder rows no entry or certificate names any more. */
async function pruneHolders(tx: Transaction, entityId: string) {
  await tx.execute(sql`
    delete from ${entityShareholders}
    where ${entityShareholders.entityId} = ${entityId}
      and not exists (
        select 1 from ${entityShareEntries}
        where ${entityShareEntries.entityId} = ${entityId}
          and (${entityShareEntries.fromHolderId} = ${entityShareholders.id}
            or ${entityShareEntries.toHolderId} = ${entityShareholders.id})
      )
      and not exists (
        select 1 from ${entityShareCertificates}
        where ${entityShareCertificates.holderId} = ${entityShareholders.id}
      )
  `);
}

/**
 * A holder Entity owning the issuer is an ownership edge, and the
 * projection has already written it to `entity_holdings` when this runs. The issuer
 * owning that holder, through Holdings or through other registers, would
 * close a loop. The loop may pass through an Entity the writer cannot
 * reach; that link still names it only as Restricted Entity (ENT-004).
 */
async function assertNoRegisterCycle(
  tx: Transaction,
  user: User,
  holderEntityId: string,
  issuerId: string,
) {
  const holdings = await tx
    .select({
      ownerEntityId: entityHoldings.ownerEntityId,
      ownedEntityId: entityHoldings.ownedEntityId,
    })
    .from(entityHoldings);
  const path = ownershipPath(holdings, issuerId, holderEntityId);
  if (!path) return;
  const loopIds = [holderEntityId, ...path];
  const names = await tx
    .select({ id: entities.id, legalName: entities.legalName })
    .from(entities)
    .where(and(inArray(entities.id, [...new Set(loopIds)]), entityReachScope(tx, user)));
  const byId = new Map(names.map((row) => [row.id, row.legalName]));
  const loop = loopIds.map((id) => byId.get(id) ?? "Restricted Entity").join(" → ");
  throw httpError(409, `This entry would create an ownership loop: ${loop}.`, {
    type: ENTITY_HOLDING_CYCLE_PROBLEM_TYPE,
  });
}

async function resolveHolder(
  tx: Transaction,
  user: User,
  issuer: { id: string },
  input: z.infer<typeof HolderInput>,
): Promise<HolderRow> {
  const holders = await readHolders(tx, issuer.id);
  if (input.kind === "holder") {
    const row = holders.find((candidate) => candidate.id === input.holderId);
    if (!row) throw httpError(400, "Pick a holder from this register.");
    return row;
  }
  if (input.kind === "entity") {
    if (input.entityId === issuer.id) throw httpError(400, "An Entity cannot hold its own shares.");
    const related = await reachedEntity(tx, user, input.entityId, { lock: true });
    if (!related || related.archivedAt)
      throw httpError(400, "Pick a live Entity from the registry.");
    const existing = holders.find((candidate) => candidate.holderEntityId === related.id);
    if (existing) return existing;
    const [inserted] = await tx
      .insert(entityShareholders)
      .values({ entityId: issuer.id, kind: "entity", holderEntityId: related.id })
      .returning({ id: entityShareholders.id });
    return (await readHolders(tx, issuer.id)).find((row) => row.id === inserted!.id)!;
  }
  const [inserted] = await tx
    .insert(entityShareholders)
    .values({ entityId: issuer.id, kind: "individual", name: input.name })
    .returning({ id: entityShareholders.id });
  return (await readHolders(tx, issuer.id)).find((row) => row.id === inserted!.id)!;
}

interface ResolvedEntry {
  from: HolderRow | null;
  to: HolderRow | null;
  shareClass: ClassRow;
  toShareClass: ClassRow | null;
}

/** Turns the body into holder rows and classes, refusing the shapes a kind cannot take. */
async function resolveEntry(
  tx: Transaction,
  user: User,
  issuer: { id: string },
  body: EntryInput,
): Promise<ResolvedEntry> {
  const classes = await readClasses(tx, issuer.id);
  const shareClass = classes.find((row) => row.id === body.shareClassId);
  if (!shareClass) throw httpError(400, "Pick a share class of this Entity.");
  if (shareClass.archivedAt) throw httpError(409, "This share class is archived.");
  const toShareClass = body.toShareClassId
    ? (classes.find((row) => row.id === body.toShareClassId) ?? null)
    : null;
  if (body.toShareClassId && !toShareClass)
    throw httpError(400, "Pick a share class of this Entity.");
  if (toShareClass?.archivedAt) throw httpError(409, "This share class is archived.");
  const wants = {
    allotment: { from: false, to: true, toClass: false },
    transfer: { from: true, to: true, toClass: false },
    buyback: { from: true, to: false, toClass: false },
    cancellation: { from: null, to: false, toClass: false },
    conversion: { from: true, to: null, toClass: true },
  }[body.kind];
  const refuse = (detail: string) => httpError(400, detail);
  if (wants.from === true && !body.from)
    throw refuse(`This ${body.kind} needs a holder the shares come from.`);
  if (wants.from === false && body.from)
    throw refuse(`This ${body.kind} comes from the company, not a holder.`);
  if (wants.to === true && !body.to)
    throw refuse(`This ${body.kind} needs a holder the shares go to.`);
  if (wants.to === false && body.to)
    throw refuse(`This ${body.kind} goes to the company, not a holder.`);
  if (wants.toClass && !toShareClass)
    throw refuse("A conversion needs the class the shares become.");
  if (!wants.toClass && toShareClass) throw refuse(`Only a conversion names a second class.`);
  if (toShareClass && toShareClass.id === shareClass.id) {
    throw refuse("A conversion needs two different classes.");
  }
  if ((body.pricePerShare ?? null) !== null && !body.priceCurrency) {
    throw refuse("A price needs its currency.");
  }
  const from = body.from ? await resolveHolder(tx, user, issuer, body.from) : null;
  const to =
    body.kind === "conversion"
      ? from
      : body.to
        ? await resolveHolder(tx, user, issuer, body.to)
        : null;
  if (body.kind === "conversion" && body.to) {
    const named = await resolveHolder(tx, user, issuer, body.to);
    if (named.id !== from?.id) throw refuse("A conversion keeps the shares with the same holder.");
  }
  if (body.kind === "transfer" && from && to && from.id === to.id) {
    throw refuse("A transfer needs two different holders.");
  }
  for (const certificate of body.certificatesIssued ?? []) {
    if (certificate.holder === "from" && !from) {
      throw refuse(
        "This entry has no holder the shares come from, so it cannot issue them a certificate.",
      );
    }
    if (certificate.holder === "to" && !to) {
      throw refuse(
        "This entry has no holder the shares go to, so it cannot issue them a certificate.",
      );
    }
  }
  return { from, to, shareClass, toShareClass };
}

function entryValues(issuerId: string, body: EntryInput, resolved: ResolvedEntry, actorId: string) {
  return {
    entityId: issuerId,
    kind: body.kind,
    effectiveOn: body.effectiveOn,
    shareClassId: resolved.shareClass.id,
    toShareClassId: resolved.toShareClass?.id ?? null,
    quantity: body.quantity,
    fromHolderId: resolved.from?.id ?? null,
    toHolderId: resolved.to?.id ?? null,
    pricePerShare: body.pricePerShare ?? null,
    priceCurrency: (body.pricePerShare ?? null) === null ? null : (body.priceCurrency ?? null),
    consideration: body.consideration || null,
    distinctiveNumbers: body.distinctiveNumbers || null,
    resolutionRef: body.resolutionRef || null,
    note: body.note || null,
    recordedBy: actorId,
  };
}

/** Attaches the body's certificates to a written entry. */
async function writeCertificates(
  tx: Transaction,
  issuerId: string,
  entryId: string,
  body: EntryInput,
  resolved: ResolvedEntry,
) {
  const cancelled = [...new Set(body.certificatesCancelled ?? [])];
  if (cancelled.length > 0) {
    const rows = await tx
      .select({
        id: entityShareCertificates.id,
        number: entityShareCertificates.number,
        cancelledByEntryId: entityShareCertificates.cancelledByEntryId,
      })
      .from(entityShareCertificates)
      .where(
        and(
          eq(entityShareCertificates.entityId, issuerId),
          inArray(entityShareCertificates.number, cancelled),
        ),
      );
    for (const number of cancelled) {
      const row = rows.find((candidate) => candidate.number === number);
      if (!row) throw httpError(400, `No certificate ${number} exists on this register.`);
      if (row.cancelledByEntryId && row.cancelledByEntryId !== entryId) {
        throw httpError(409, `Certificate ${number} was already cancelled by another entry.`);
      }
    }
    await tx
      .update(entityShareCertificates)
      .set({ cancelledByEntryId: entryId, updatedAt: new Date() })
      .where(
        inArray(
          entityShareCertificates.id,
          rows.map((row) => row.id),
        ),
      );
  }
  const issued = body.certificatesIssued ?? [];
  const numbers = new Set<string>();
  for (const certificate of issued) {
    if (numbers.has(certificate.number)) {
      throw httpError(400, `Certificate ${certificate.number} is listed twice.`);
    }
    numbers.add(certificate.number);
  }
  if (issued.length > 0) {
    const taken = await tx
      .select({ number: entityShareCertificates.number })
      .from(entityShareCertificates)
      .where(
        and(
          eq(entityShareCertificates.entityId, issuerId),
          inArray(entityShareCertificates.number, [...numbers]),
        ),
      );
    if (taken.length > 0) {
      throw httpError(409, `Certificate ${taken[0]!.number} already exists on this register.`);
    }
    await tx.insert(entityShareCertificates).values(
      issued.map((certificate) => ({
        entityId: issuerId,
        number: certificate.number,
        holderId: certificate.holder === "from" ? resolved.from!.id : resolved.to!.id,
        shareClassId:
          certificate.holder === "to" && resolved.toShareClass
            ? resolved.toShareClass.id
            : resolved.shareClass.id,
        quantity: certificate.quantity,
        distinctiveNumbers: certificate.distinctiveNumbers || null,
        issuedByEntryId: entryId,
      })),
    );
  }
}

/** Frees an entry's certificates before it is rewritten or removed. */
async function detachCertificates(tx: Transaction, entryId: string) {
  const later = await tx
    .select({ number: entityShareCertificates.number })
    .from(entityShareCertificates)
    .where(
      and(
        eq(entityShareCertificates.issuedByEntryId, entryId),
        sql`${entityShareCertificates.cancelledByEntryId} is not null`,
      ),
    );
  if (later.length > 0) {
    throw httpError(
      409,
      `Certificate ${later[0]!.number}, issued by this entry, was cancelled by a later entry. Change that entry first.`,
    );
  }
  await tx
    .update(entityShareCertificates)
    .set({ cancelledByEntryId: null, updatedAt: new Date() })
    .where(eq(entityShareCertificates.cancelledByEntryId, entryId));
  await tx
    .delete(entityShareCertificates)
    .where(eq(entityShareCertificates.issuedByEntryId, entryId));
}

type EntryActivityInput = {
  actorId: string;
  issuer: { id: string; legalName: string };
  entry: { entryNo: number; kind: string; quantity: number; effectiveOn: string };
  className: string;
  from: HolderRow | null;
  to: HolderRow | null;
};

/** One entry on the issuer and on each Entity holder it names. */
async function recordEntryActivity(
  tx: Transaction,
  action: "entity_share_entry.created" | "entity_share_entry.deleted",
  input: EntryActivityInput,
): Promise<void>;
async function recordEntryActivity(
  tx: Transaction,
  action: "entity_share_entry.updated",
  input: EntryActivityInput & { changed: ChangedFields },
): Promise<void>;
async function recordEntryActivity(
  tx: Transaction,
  action:
    "entity_share_entry.created" | "entity_share_entry.updated" | "entity_share_entry.deleted",
  input: EntryActivityInput & { changed?: ChangedFields },
) {
  const targets: { id: string; legalName: string }[] = [input.issuer];
  for (const holder of [input.from, input.to]) {
    if (holder?.kind === "entity" && holder.holderEntityId && holder.entityName) {
      if (!targets.some((target) => target.id === holder.holderEntityId)) {
        targets.push({ id: holder.holderEntityId, legalName: holder.entityName });
      }
    }
  }
  for (const target of targets) {
    const payload = {
      legalName: target.legalName,
      entryNo: input.entry.entryNo,
      kind: input.entry.kind,
      className: input.className,
      quantity: input.entry.quantity,
      fromName: input.from ? holderName(input.from) : null,
      toName: input.to ? holderName(input.to) : null,
      effectiveOn: input.entry.effectiveOn,
    };
    const common = {
      entityType: "entity" as const,
      entityId: target.id,
      actorId: input.actorId,
      visibility: "legal_only" as const,
    };
    if (action === "entity_share_entry.updated") {
      await recordActivity(tx, {
        ...common,
        action,
        payload: { ...payload, changed: input.changed ?? {} },
      });
    } else {
      await recordActivity(tx, { ...common, action, payload });
    }
  }
}

function changedBetween<T extends Record<string, unknown>>(before: T, after: T): ChangedFields {
  const changed: ChangedFields = {};
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changed[key] = { from, to };
  }
  return changed;
}

async function nextEntryNo(tx: Transaction, entityId: string) {
  const [row] = await tx
    .insert(entityShareEntryCounters)
    .values({ entityId, lastEntryNo: 1 })
    .onConflictDoUpdate({
      target: entityShareEntryCounters.entityId,
      set: { lastEntryNo: sql`${entityShareEntryCounters.lastEntryNo} + 1` },
    })
    .returning({ next: entityShareEntryCounters.lastEntryNo });
  return row!.next;
}

async function assertClassNameFree(
  tx: Transaction,
  entityId: string,
  name: string,
  exceptId?: string,
) {
  const rows = await tx
    .select({ id: entityShareClasses.id })
    .from(entityShareClasses)
    .where(
      and(
        eq(entityShareClasses.entityId, entityId),
        isNull(entityShareClasses.archivedAt),
        sql`lower(${entityShareClasses.name}) = lower(${name})`,
      ),
    );
  if (rows.some((row) => row.id !== exceptId)) {
    throw httpError(409, `A share class named ${name} already exists on this Entity.`);
  }
}

/** RFC 4180: quote a field when it holds a comma, a quote or a line break. */
function csv(rows: readonly (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

function csvHolder(ref: { restricted: boolean; name?: string } | null) {
  return ref === null ? "" : ref.restricted ? "Restricted Entity" : (ref.name ?? "");
}

/** A filename the browser keeps: the legal name minus what a filesystem refuses. */
function fileStem(legalName: string) {
  return (
    legalName
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "entity"
  );
}

export const entityShareRegisterRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/:id/share-register/export",
    {
      preHandler: requireMember,
      schema: {
        operationId: "exportEntityShareRegister",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({
          asOf: z.iso.date().optional(),
          kind: z.enum(["members", "entries"]).default("members"),
        }),
        response: { 200: z.string(), default: problemResponse },
      },
    },
    async (request, reply) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      const register = await readRegister(
        app.db,
        request.user,
        entity,
        request.query.asOf ?? todayIsoDate(),
      );
      const className = new Map(register.classes.map((row) => [row.id, row.name]));
      const rows: (string | number | null)[][] =
        request.query.kind === "members"
          ? [
              [
                "Holder",
                "Holder kind",
                "Jurisdiction",
                "Class",
                "Shares",
                "% of class",
                "% voting",
                "Certificates",
                "Member since",
              ],
              ...register.holders.map((row) => [
                csvHolder(row.holder),
                row.holder.restricted ? "" : row.holder.kind,
                row.holder.restricted ? "" : (row.holder.jurisdiction ?? ""),
                className.get(row.shareClassId) ?? "",
                row.balance,
                row.percentOfClass,
                row.percentOfVotes,
                row.certificates.join(" "),
                row.memberSince,
              ]),
              ...register.treasury.map((row) => [
                "Treasury",
                "treasury",
                "",
                className.get(row.shareClassId) ?? "",
                row.balance,
                null,
                null,
                "",
                null,
              ]),
            ]
          : [
              [
                "No.",
                "Date",
                "Entry",
                "From",
                "To",
                "Class",
                "To class",
                "Shares",
                "Price per share",
                "Currency",
                "Consideration",
                "Distinctive numbers",
                "Certificates issued",
                "Certificates cancelled",
                "Resolution",
                "Note",
              ],
              ...register.entries.map((row) => [
                row.entryNo,
                row.effectiveOn,
                row.kind,
                csvHolder(row.from),
                csvHolder(row.kind === "conversion" ? row.from : row.to),
                className.get(row.shareClassId) ?? "",
                row.toShareClassId ? (className.get(row.toShareClassId) ?? "") : "",
                row.quantity,
                row.pricePerShare,
                row.priceCurrency,
                row.consideration,
                row.distinctiveNumbers,
                row.certificatesIssued.map((certificate) => certificate.number).join(" "),
                row.certificatesCancelled.join(" "),
                row.resolutionRef,
                row.note,
              ]),
            ];
      const stem = fileStem(entity.legalName);
      const filename =
        request.query.kind === "members"
          ? `${stem} register of members ${register.asOf}.csv`
          : `${stem} register of entries.csv`;
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${filename.replace(/"/g, "")}"`)
        .send("\uFEFF" + csv(rows));
    },
  );

  app.get(
    "/entities/:id/share-register",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getEntityShareRegister",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({ asOf: z.iso.date().optional() }),
        response: { 200: RegisterEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      return readRegister(app.db, request.user, entity, request.query.asOf ?? todayIsoDate());
    },
  );

  app.post(
    "/entities/:id/share-classes",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityShareClass",
        tags: ["entities"],
        params: IdParams,
        body: ShareClassBody,
        response: { 201: RegisterEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const written = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityShareRegister})`);
        const entity = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!entity) throw httpError(404, NO_ENTITY);
        assertEditable(entity);
        await assertClassNameFree(tx, entity.id, request.body.name);
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(entityShareClasses)
          .where(eq(entityShareClasses.entityId, entity.id));
        await tx.insert(entityShareClasses).values({
          entityId: entity.id,
          name: request.body.name,
          authorized: request.body.authorized ?? null,
          parValue: request.body.parValue ?? null,
          parValueCurrency:
            (request.body.parValue ?? null) === null
              ? null
              : (request.body.parValueCurrency ?? null),
          votesPerShare: String(request.body.votesPerShare ?? 1),
          rights: request.body.rights || null,
          position: count?.count ?? 0,
        });
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_share_class.created",
          visibility: "legal_only",
          payload: { legalName: entity.legalName, className: request.body.name },
        });
        return readRegister(tx, request.user, entity, todayIsoDate());
      });
      return reply.status(201).send(written);
    },
  );

  app.patch(
    "/entities/:id/share-classes/:classId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityShareClass",
        tags: ["entities"],
        params: ClassParams,
        body: ShareClassBody.partial(),
        response: { 200: RegisterEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityShareRegister})`);
        const entity = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!entity) throw httpError(404, NO_ENTITY);
        assertEditable(entity);
        const current = (await readClasses(tx, entity.id)).find(
          (row) => row.id === request.params.classId,
        );
        if (!current) throw httpError(404, "No share class exists with this id.");
        if (current.archivedAt) throw httpError(409, "This share class is archived.");
        const name = request.body.name ?? current.name;
        if (name !== current.name) await assertClassNameFree(tx, entity.id, name, current.id);
        const parValue =
          request.body.parValue === undefined ? current.parValue : request.body.parValue;
        const next = {
          name,
          authorized:
            request.body.authorized === undefined ? current.authorized : request.body.authorized,
          parValue,
          parValueCurrency:
            parValue === null
              ? null
              : request.body.parValueCurrency === undefined
                ? current.parValueCurrency
                : request.body.parValueCurrency,
          votesPerShare: request.body.votesPerShare ?? current.votesPerShare,
          rights: request.body.rights === undefined ? current.rights : request.body.rights || null,
        };
        const before = {
          name: current.name,
          authorized: current.authorized,
          parValue: current.parValue,
          parValueCurrency: current.parValueCurrency,
          votesPerShare: current.votesPerShare,
          rights: current.rights,
        };
        const changed = changedBetween(before, next);
        if (Object.keys(changed).length > 0) {
          await tx
            .update(entityShareClasses)
            .set({ ...next, votesPerShare: String(next.votesPerShare), updatedAt: new Date() })
            .where(eq(entityShareClasses.id, current.id));
          await recordActivity(tx, {
            entityType: "entity",
            entityId: entity.id,
            actorId: request.user.id,
            action: "entity_share_class.updated",
            visibility: "legal_only",
            payload: { legalName: entity.legalName, className: next.name, changed },
          });
        }
        return readRegister(tx, request.user, entity, todayIsoDate());
      }),
  );

  app.delete(
    "/entities/:id/share-classes/:classId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveEntityShareClass",
        tags: ["entities"],
        params: ClassParams,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityShareRegister})`);
        const entity = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!entity) throw httpError(404, NO_ENTITY);
        assertEditable(entity);
        const current = (await readClasses(tx, entity.id)).find(
          (row) => row.id === request.params.classId,
        );
        if (!current) throw httpError(404, "No share class exists with this id.");
        if (current.archivedAt) return;
        if (current.entryCount > 0) {
          throw httpError(409, "This share class has register entries. Remove them first.");
        }
        await tx
          .update(entityShareClasses)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(entityShareClasses.id, current.id));
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_share_class.archived",
          visibility: "legal_only",
          payload: { legalName: entity.legalName, className: current.name },
        });
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/entities/:id/share-entries",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityShareEntry",
        tags: ["entities"],
        params: IdParams,
        body: EntryBody,
        response: { 201: RegisterEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const written = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityShareRegister})`);
        const entity = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!entity) throw httpError(404, NO_ENTITY);
        assertEditable(entity);
        const resolved = await resolveEntry(tx, request.user, entity, request.body);
        const entryNo = await nextEntryNo(tx, entity.id);
        const [inserted] = await tx
          .insert(entityShareEntries)
          .values({ ...entryValues(entity.id, request.body, resolved, request.user.id), entryNo })
          .returning({ id: entityShareEntries.id });
        await writeCertificates(tx, entity.id, inserted!.id, request.body, resolved);
        await assertSoundRegister(tx, entity.id);
        await projectRegisterHoldings(tx, request.user.id, entity);
        if (resolved.to?.kind === "entity" && resolved.to.holderEntityId) {
          await assertNoRegisterCycle(tx, request.user, resolved.to.holderEntityId, entity.id);
        }
        await recordEntryActivity(tx, "entity_share_entry.created", {
          actorId: request.user.id,
          issuer: entity,
          entry: { entryNo, ...request.body },
          className: resolved.shareClass.name,
          from: resolved.from,
          to: resolved.to,
        });
        return readRegister(tx, request.user, entity, todayIsoDate());
      });
      return reply.status(201).send(written);
    },
  );

  app.patch(
    "/entities/:id/share-entries/:entryId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityShareEntry",
        tags: ["entities"],
        params: EntryParams,
        body: EntryBody,
        response: { 200: RegisterEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityShareRegister})`);
        const entity = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!entity) throw httpError(404, NO_ENTITY);
        assertEditable(entity);
        const [current] = await tx
          .select()
          .from(entityShareEntries)
          .where(
            and(
              eq(entityShareEntries.entityId, entity.id),
              eq(entityShareEntries.id, request.params.entryId),
            ),
          );
        if (!current) throw httpError(404, "No register entry exists with this id.");
        const resolved = await resolveEntry(tx, request.user, entity, request.body);
        await detachCertificates(tx, current.id);
        const values = entryValues(entity.id, request.body, resolved, request.user.id);
        await tx
          .update(entityShareEntries)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(entityShareEntries.id, current.id));
        await writeCertificates(tx, entity.id, current.id, request.body, resolved);
        await pruneHolders(tx, entity.id);
        await assertSoundRegister(tx, entity.id);
        await projectRegisterHoldings(tx, request.user.id, entity);
        if (resolved.to?.kind === "entity" && resolved.to.holderEntityId) {
          await assertNoRegisterCycle(tx, request.user, resolved.to.holderEntityId, entity.id);
        }
        const holders = await readHolders(tx, entity.id);
        const nameOf = (holderId: string | null) => {
          const holder = holderId ? holders.find((row) => row.id === holderId) : undefined;
          return holder ? holderName(holder) : null;
        };
        const changed = changedBetween(
          {
            kind: current.kind,
            effectiveOn: current.effectiveOn,
            shareClassId: current.shareClassId,
            toShareClassId: current.toShareClassId,
            quantity: current.quantity,
            from: nameOf(current.fromHolderId),
            to: nameOf(current.toHolderId),
            pricePerShare: current.pricePerShare,
            priceCurrency: current.priceCurrency,
            consideration: current.consideration,
            distinctiveNumbers: current.distinctiveNumbers,
            resolutionRef: current.resolutionRef,
            note: current.note,
          },
          {
            kind: values.kind,
            effectiveOn: values.effectiveOn,
            shareClassId: values.shareClassId,
            toShareClassId: values.toShareClassId,
            quantity: values.quantity,
            from: nameOf(values.fromHolderId),
            to: nameOf(values.toHolderId),
            pricePerShare: values.pricePerShare,
            priceCurrency: values.priceCurrency,
            consideration: values.consideration,
            distinctiveNumbers: values.distinctiveNumbers,
            resolutionRef: values.resolutionRef,
            note: values.note,
          },
        );
        await recordEntryActivity(tx, "entity_share_entry.updated", {
          actorId: request.user.id,
          issuer: entity,
          entry: { entryNo: current.entryNo, ...request.body },
          className: resolved.shareClass.name,
          from: resolved.from,
          to: resolved.to,
          changed,
        });
        return readRegister(tx, request.user, entity, todayIsoDate());
      }),
  );

  app.delete(
    "/entities/:id/share-entries/:entryId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityShareEntry",
        tags: ["entities"],
        params: EntryParams,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityShareRegister})`);
        const entity = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!entity) throw httpError(404, NO_ENTITY);
        assertEditable(entity);
        const [current] = await tx
          .select()
          .from(entityShareEntries)
          .where(
            and(
              eq(entityShareEntries.entityId, entity.id),
              eq(entityShareEntries.id, request.params.entryId),
            ),
          );
        if (!current) throw httpError(404, "No register entry exists with this id.");
        const holders = await readHolders(tx, entity.id);
        const classes = await readClasses(tx, entity.id);
        await detachCertificates(tx, current.id);
        await tx.delete(entityShareEntries).where(eq(entityShareEntries.id, current.id));
        await assertSoundRegister(tx, entity.id);
        await projectRegisterHoldings(tx, request.user.id, entity);
        await pruneHolders(tx, entity.id);
        await recordEntryActivity(tx, "entity_share_entry.deleted", {
          actorId: request.user.id,
          issuer: entity,
          entry: current,
          className: classes.find((row) => row.id === current.shareClassId)?.name ?? "",
          from: holders.find((row) => row.id === current.fromHolderId) ?? null,
          to: holders.find((row) => row.id === current.toHolderId) ?? null,
        });
      });
      return reply.status(204).send(null);
    },
  );
};
