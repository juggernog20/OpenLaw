// SPDX-License-Identifier: AGPL-3.0-only
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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { entities } from "./entities.js";
import { entityRegisterParties } from "./entity-trust-register.js";
import { uuidPk } from "./helpers.js";
export const PARTNERSHIP_BASES = ["capital", "units", "stated", "equal"] as const;
export type PartnershipBasis = (typeof PARTNERSHIP_BASES)[number];
export const PARTNERSHIP_CAPACITIES = ["general", "limited"] as const;
export type PartnershipCapacity = (typeof PARTNERSHIP_CAPACITIES)[number];
export const PARTNERSHIP_ENTRY_KINDS = [
  "admission",
  "commitment",
  "contribution",
  "return",
  "transfer",
  "capacity_change",
  "withdrawal",
] as const;
export type PartnershipEntryKind = (typeof PARTNERSHIP_ENTRY_KINDS)[number];
export const entityPartnershipEntries = pgTable(
  "entity_partnership_entries",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    entryNo: integer("entry_no").notNull(),
    kind: text("kind", { enum: PARTNERSHIP_ENTRY_KINDS }).notNull(),
    effectiveOn: date("effective_on").notNull(),
    partyId: text("party_id"),
    fromPartyId: text("from_party_id"),
    toPartyId: text("to_party_id"),
    capacity: text("capacity", { enum: PARTNERSHIP_CAPACITIES }),
    transfereeStatus: text("transferee_status", { enum: ["admitted", "assignee"] }),
    units: bigint("units", { mode: "number" }),
    statedPercent: numeric("stated_percent", { precision: 5, scale: 2 }),
    amount: bigint("amount", { mode: "number" }),
    currency: text("currency"),
    formOfContribution: text("form_of_contribution"),
    consideration: text("consideration"),
    reference: text("reference"),
    note: text("note"),
    recordedBy: text("recorded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("entity_partnership_entries_entity_no_idx").on(t.entityId, t.entryNo),
    index("entity_partnership_entries_entity_date_idx").on(t.entityId, t.effectiveOn),
    ...[t.partyId, t.fromPartyId, t.toPartyId].map((column, i) =>
      foreignKey({
        name: `entity_partnership_entries_party_${i}_fk`,
        columns: [t.entityId, column],
        foreignColumns: [entityRegisterParties.entityId, entityRegisterParties.id],
      }),
    ),
    check("entity_partnership_entries_entry_no_positive", sql`${t.entryNo}>0`),
    check(
      "entity_partnership_entries_capacity",
      sql`${t.capacity} is null or ${t.capacity} in ('general','limited')`,
    ),
    check(
      "entity_partnership_entries_ranges",
      sql`(${t.units} is null or ${t.units} between 0 and 9007199254740991) and (${t.statedPercent} is null or ${t.statedPercent} between 0 and 100) and (${t.amount} is null or ${t.amount} between 1 and 9007199254740991)`,
    ),
    check(
      "entity_partnership_entries_currency",
      sql`(${t.amount} is null and ${t.currency} is null) or (${t.amount} is not null and ${t.currency} is not null and ${t.currency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "entity_partnership_entries_parties",
      sql`case when ${t.kind}='transfer' then ${t.partyId} is null and ${t.fromPartyId} is not null and ${t.toPartyId} is not null and ${t.fromPartyId}<>${t.toPartyId} else ${t.partyId} is not null and ${t.fromPartyId} is null and ${t.toPartyId} is null end`,
    ),
    check(
      "entity_partnership_entries_kind_shape",
      sql`case
    when ${t.kind}='admission' then ${t.capacity} is not null and ${t.amount} is null and ${t.transfereeStatus} is null
    when ${t.kind} in ('commitment','contribution','return') then ${t.capacity} is null and ${t.amount} is not null and ${t.units} is null and ${t.statedPercent} is null and ${t.transfereeStatus} is null
    when ${t.kind}='transfer' then (coalesce(${t.units},0)>0 or coalesce(${t.statedPercent},0)>0 or ${t.amount} is not null) and (${t.transfereeStatus} is null or ${t.transfereeStatus} in ('admitted','assignee')) and case when ${t.transfereeStatus}='admitted' then ${t.capacity} is not null else ${t.capacity} is null end
    when ${t.kind}='capacity_change' then ${t.capacity} is not null and ${t.units} is null and ${t.statedPercent} is null and ${t.amount} is null and ${t.transfereeStatus} is null
    when ${t.kind}='withdrawal' then ${t.capacity} is null and ${t.units} is null and ${t.statedPercent} is null and ${t.amount} is null and ${t.transfereeStatus} is null
    else false end`,
    ),
    check(
      "entity_partnership_entries_text",
      sql`(${t.formOfContribution} is null or (${t.kind}='contribution' and length(trim(${t.formOfContribution})) between 1 and 2000)) and (${t.consideration} is null or (${t.kind}='transfer' and length(trim(${t.consideration})) between 1 and 2000)) and (${t.reference} is null or length(${t.reference})<=200) and (${t.note} is null or length(${t.note})<=2000)`,
    ),
  ],
);
