// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { entities } from "./entities.js";
import { uuidPk } from "./helpers.js";

export const REGISTER_PARTY_KINDS = ["entity", "individual", "class"] as const;
export const TRUST_ENTRY_KINDS = [
  "appointment",
  "cessation",
  "settlement",
  "distribution",
] as const;
export const TRUST_ROLES = [
  "settlor",
  "trustee",
  "protector",
  "enforcer",
  "beneficiary",
  "other",
] as const;
export type TrustEntryKind = (typeof TRUST_ENTRY_KINDS)[number];
export type TrustRole = (typeof TRUST_ROLES)[number];
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Shared by the trust and partnership registers; entries own each party's lifetime. */
export const entityRegisterParties = pgTable(
  "entity_register_parties",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    kind: text("kind", { enum: REGISTER_PARTY_KINDS }).notNull(),
    partyEntityId: text("party_entity_id").references(() => entities.id),
    name: text("name"),
    description: text("description"),
    ...timestamps(),
  },
  (t) => [
    unique("entity_register_parties_entity_id_id_key").on(t.entityId, t.id),
    uniqueIndex("entity_register_parties_entity_party_idx")
      .on(t.entityId, t.partyEntityId)
      .where(sql`${t.partyEntityId} is not null`),
    check(
      "entity_register_parties_kind_shape",
      sql`case ${t.kind}
    when 'entity' then ${t.partyEntityId} is not null and ${t.name} is null and ${t.description} is null
    when 'individual' then ${t.partyEntityId} is null and ${t.name} is not null and length(trim(${t.name})) between 1 and 200 and ${t.description} is null
    when 'class' then ${t.partyEntityId} is null and ${t.name} is null and ${t.description} is not null and length(trim(${t.description})) between 1 and 2000
    else false end`,
    ),
  ],
);

/** A deleted entry never lowers the high-water mark. */
export const entityRegisterEntryCounters = pgTable(
  "entity_register_entry_counters",
  {
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    register: text("register", { enum: ["trust", "partnership"] }).notNull(),
    lastEntryNo: integer("last_entry_no").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.register] }),
    check(
      "entity_register_entry_counters_register_check",
      sql`${t.register} in ('trust', 'partnership')`,
    ),
    check("entity_register_entry_counters_nonnegative", sql`${t.lastEntryNo} >= 0`),
  ],
);

export const entityTrustEntries = pgTable(
  "entity_trust_entries",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    entryNo: integer("entry_no").notNull(),
    kind: text("kind", { enum: TRUST_ENTRY_KINDS }).notNull(),
    effectiveOn: date("effective_on").notNull(),
    partyId: text("party_id").notNull(),
    role: text("role", { enum: TRUST_ROLES }),
    roleLabel: text("role_label"),
    interest: text("interest"),
    amount: bigint("amount", { mode: "number" }),
    currency: text("currency"),
    property: text("property"),
    reference: text("reference"),
    note: text("note"),
    recordedBy: text("recorded_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    unique("entity_trust_entries_entity_id_id_key").on(t.entityId, t.id),
    uniqueIndex("entity_trust_entries_entity_no_idx").on(t.entityId, t.entryNo),
    index("entity_trust_entries_entity_date_idx").on(t.entityId, t.effectiveOn),
    foreignKey({
      name: "entity_trust_entries_party_fk",
      columns: [t.entityId, t.partyId],
      foreignColumns: [entityRegisterParties.entityId, entityRegisterParties.id],
    }),
    check("entity_trust_entries_entry_no_positive", sql`${t.entryNo} > 0`),
    check(
      "entity_trust_entries_role_check",
      sql`${t.role} is null or ${t.role} in ('settlor', 'trustee', 'protector', 'enforcer', 'beneficiary', 'other')`,
    ),
    check(
      "entity_trust_entries_role_label",
      sql`case when ${t.role} = 'other' then ${t.roleLabel} is not null and length(trim(${t.roleLabel})) between 1 and 200 else ${t.roleLabel} is null end`,
    ),
    check(
      "entity_trust_entries_kind_shape",
      sql`case
    when ${t.kind} in ('appointment', 'cessation') then ${t.role} is not null and ${t.amount} is null and ${t.currency} is null and ${t.property} is null
    when ${t.kind} in ('settlement', 'distribution') then ${t.role} is null and (
      (${t.amount} is not null and ${t.currency} is not null and ${t.property} is null) or
      (${t.amount} is null and ${t.currency} is null and ${t.property} is not null and length(trim(${t.property})) between 1 and 2000))
    else false end`,
    ),
    check(
      "entity_trust_entries_amount_range",
      sql`${t.amount} is null or (${t.amount} > 0 and ${t.amount} <= 9007199254740991)`,
    ),
    check(
      "entity_trust_entries_currency_check",
      sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "entity_trust_entries_text_lengths",
      sql`(${t.interest} is null or length(${t.interest}) <= 2000) and (${t.reference} is null or length(${t.reference}) <= 200) and (${t.note} is null or length(${t.note}) <= 2000)`,
    ),
  ],
);
