// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The share register (ENT-011): classes, holders, entries and
 * certificates. Balances are never stored. The Register of members is
 * a replay of the entries to a date, so the register cannot disagree
 * with itself. Holdings (ENT-003) are projected from it where one
 * exists.
 *
 * Every dependant references its parent by (entity_id, id), so a class,
 * holder or entry can only be named by its own Entity's register; a
 * single-column key would let a direct write stitch two registers
 * together.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { entities } from "./entities.js";
import { uuidPk } from "./helpers.js";

export const SHARE_ENTRY_KINDS = [
  "allotment",
  "transfer",
  "buyback",
  "cancellation",
  "conversion",
] as const;
export type ShareEntryKind = (typeof SHARE_ENTRY_KINDS)[number];

export const SHAREHOLDER_KINDS = ["entity", "individual"] as const;
export type ShareholderKind = (typeof SHAREHOLDER_KINDS)[number];

/** The JS boundary: bigint columns read through `Number`, so nothing above this is stored. */
const MAX_SAFE = sql.raw("9007199254740991");

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** One class of shares an Entity may issue. Archivable; a class with entries refuses. */
export const entityShareClasses = pgTable(
  "entity_share_classes",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    authorized: bigint("authorized", { mode: "number" }),
    /** Minor currency units, as `entities.par_value`. */
    parValue: bigint("par_value", { mode: "number" }),
    parValueCurrency: text("par_value_currency"),
    votesPerShare: numeric("votes_per_share", { precision: 10, scale: 4 }).notNull().default("1"),
    /** A free-text rights summary: dividend, liquidation, conversion. */
    rights: text("rights"),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("entity_share_classes_entity_idx").on(table.entityId),
    unique("entity_share_classes_entity_id_id_key").on(table.entityId, table.id),
    uniqueIndex("entity_share_classes_live_name_idx")
      .on(table.entityId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    check("entity_share_classes_name_length", sql`length(trim(${table.name})) between 1 and 100`),
    check(
      "entity_share_classes_authorized_range",
      sql`${table.authorized} is null or (${table.authorized} >= 0 and ${table.authorized} <= ${MAX_SAFE})`,
    ),
    check(
      "entity_share_classes_par_value_range",
      sql`${table.parValue} is null or (${table.parValue} >= 0 and ${table.parValue} <= ${MAX_SAFE})`,
    ),
    check("entity_share_classes_votes_range", sql`${table.votesPerShare} >= 0`),
    check(
      "entity_share_classes_rights_length",
      sql`${table.rights} is null or length(${table.rights}) <= 500`,
    ),
  ],
);

/** A party on one issuer's register. A row exists because an entry names it. */
export const entityShareholders = pgTable(
  "entity_shareholders",
  {
    id: uuidPk(),
    /** The issuer. */
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    kind: text("kind", { enum: SHAREHOLDER_KINDS }).notNull(),
    holderEntityId: text("holder_entity_id").references(() => entities.id),
    name: text("name"),
    ...timestamps(),
  },
  (table) => [
    index("entity_shareholders_entity_idx").on(table.entityId),
    unique("entity_shareholders_entity_id_id_key").on(table.entityId, table.id),
    uniqueIndex("entity_shareholders_entity_holder_idx")
      .on(table.entityId, table.holderEntityId)
      .where(sql`${table.kind} = 'entity'`),
    check(
      "entity_shareholders_kind_shape",
      sql`(${table.kind} = 'entity' and ${table.holderEntityId} is not null and ${table.name} is null)
        or (${table.kind} = 'individual' and ${table.holderEntityId} is null and length(trim(${table.name})) between 1 and 200)`,
    ),
    check(
      "entity_shareholders_not_self",
      sql`${table.holderEntityId} is null or ${table.holderEntityId} <> ${table.entityId}`,
    ),
  ],
);

/** One dated movement of shares. Per-kind CHECKs pin which ends may be null. */
export const entityShareEntries = pgTable(
  "entity_share_entries",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    /** Per Entity, from `entity_share_entry_counters`, never reused. */
    entryNo: integer("entry_no").notNull(),
    kind: text("kind", { enum: SHARE_ENTRY_KINDS }).notNull(),
    effectiveOn: date("effective_on").notNull(),
    shareClassId: text("share_class_id").notNull(),
    /** Conversion only: the class the shares become. */
    toShareClassId: text("to_share_class_id"),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    fromHolderId: text("from_holder_id"),
    toHolderId: text("to_holder_id"),
    /** Minor currency units. */
    pricePerShare: bigint("price_per_share", { mode: "number" }),
    priceCurrency: text("price_currency"),
    consideration: text("consideration"),
    distinctiveNumbers: text("distinctive_numbers"),
    resolutionRef: text("resolution_ref"),
    note: text("note"),
    recordedBy: text("recorded_by").references(() => users.id),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("entity_share_entries_entity_no_idx").on(table.entityId, table.entryNo),
    unique("entity_share_entries_entity_id_id_key").on(table.entityId, table.id),
    index("entity_share_entries_entity_date_idx").on(table.entityId, table.effectiveOn),
    foreignKey({
      name: "entity_share_entries_class_fk",
      columns: [table.entityId, table.shareClassId],
      foreignColumns: [entityShareClasses.entityId, entityShareClasses.id],
    }),
    foreignKey({
      name: "entity_share_entries_to_class_fk",
      columns: [table.entityId, table.toShareClassId],
      foreignColumns: [entityShareClasses.entityId, entityShareClasses.id],
    }),
    foreignKey({
      name: "entity_share_entries_from_holder_fk",
      columns: [table.entityId, table.fromHolderId],
      foreignColumns: [entityShareholders.entityId, entityShareholders.id],
    }),
    foreignKey({
      name: "entity_share_entries_to_holder_fk",
      columns: [table.entityId, table.toHolderId],
      foreignColumns: [entityShareholders.entityId, entityShareholders.id],
    }),
    check("entity_share_entries_entry_no_positive", sql`${table.entryNo} > 0`),
    check(
      "entity_share_entries_quantity_positive",
      sql`${table.quantity} > 0 and ${table.quantity} <= ${MAX_SAFE}`,
    ),
    check(
      "entity_share_entries_kind_shape",
      sql`case ${table.kind}
        when 'allotment' then ${table.fromHolderId} is null and ${table.toHolderId} is not null and ${table.toShareClassId} is null
        when 'transfer' then ${table.fromHolderId} is not null and ${table.toHolderId} is not null and ${table.fromHolderId} <> ${table.toHolderId} and ${table.toShareClassId} is null
        when 'buyback' then ${table.fromHolderId} is not null and ${table.toHolderId} is null and ${table.toShareClassId} is null
        when 'cancellation' then ${table.toHolderId} is null and ${table.toShareClassId} is null
        when 'conversion' then ${table.fromHolderId} is not null and ${table.toHolderId} = ${table.fromHolderId} and ${table.toShareClassId} is not null and ${table.toShareClassId} <> ${table.shareClassId}
        else false end`,
    ),
    check(
      "entity_share_entries_price_range",
      sql`${table.pricePerShare} is null or (${table.pricePerShare} >= 0 and ${table.pricePerShare} <= ${MAX_SAFE})`,
    ),
    check(
      "entity_share_entries_text_lengths",
      sql`(${table.consideration} is null or length(${table.consideration}) <= 500)
      and (${table.distinctiveNumbers} is null or length(${table.distinctiveNumbers}) <= 200)
      and (${table.resolutionRef} is null or length(${table.resolutionRef}) <= 200)
      and (${table.note} is null or length(${table.note}) <= 2000)`,
    ),
  ],
);

/** A numbered certificate for one holder and class, issued by one entry and cancelled by at most one. */
export const entityShareCertificates = pgTable(
  "entity_share_certificates",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    number: text("number").notNull(),
    holderId: text("holder_id").notNull(),
    shareClassId: text("share_class_id").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    distinctiveNumbers: text("distinctive_numbers"),
    issuedByEntryId: text("issued_by_entry_id").notNull(),
    cancelledByEntryId: text("cancelled_by_entry_id"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("entity_share_certificates_entity_number_idx").on(table.entityId, table.number),
    index("entity_share_certificates_issued_idx").on(table.issuedByEntryId),
    index("entity_share_certificates_cancelled_idx").on(table.cancelledByEntryId),
    foreignKey({
      name: "entity_share_certificates_holder_fk",
      columns: [table.entityId, table.holderId],
      foreignColumns: [entityShareholders.entityId, entityShareholders.id],
    }),
    foreignKey({
      name: "entity_share_certificates_class_fk",
      columns: [table.entityId, table.shareClassId],
      foreignColumns: [entityShareClasses.entityId, entityShareClasses.id],
    }),
    foreignKey({
      name: "entity_share_certificates_issued_fk",
      columns: [table.entityId, table.issuedByEntryId],
      foreignColumns: [entityShareEntries.entityId, entityShareEntries.id],
    }),
    foreignKey({
      name: "entity_share_certificates_cancelled_fk",
      columns: [table.entityId, table.cancelledByEntryId],
      foreignColumns: [entityShareEntries.entityId, entityShareEntries.id],
    }),
    check(
      "entity_share_certificates_number_length",
      sql`length(trim(${table.number})) between 1 and 50`,
    ),
    check(
      "entity_share_certificates_quantity_positive",
      sql`${table.quantity} > 0 and ${table.quantity} <= ${MAX_SAFE}`,
    ),
    check(
      "entity_share_certificates_distinctive_length",
      sql`${table.distinctiveNumbers} is null or length(${table.distinctiveNumbers}) <= 200`,
    ),
  ],
);

/**
 * The last entry number handed out per issuer. Entry numbers are never
 * reused, so a deleted entry leaves a gap and the counter, not
 * `max(entry_no)`, says what comes next.
 */
export const entityShareEntryCounters = pgTable(
  "entity_share_entry_counters",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references(() => entities.id),
    lastEntryNo: integer("last_entry_no").notNull().default(0),
  },
  (table) => [check("entity_share_entry_counters_non_negative", sql`${table.lastEntryNo} >= 0`)],
);

export type EntityShareClass = typeof entityShareClasses.$inferSelect;
export type EntityShareholder = typeof entityShareholders.$inferSelect;
export type EntityShareEntry = typeof entityShareEntries.$inferSelect;
export type EntityShareCertificate = typeof entityShareCertificates.$inferSelect;
