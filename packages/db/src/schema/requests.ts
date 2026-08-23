// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request envelope (INT-001, INT-002): what a Business User submits
 * through a portal form, and the row every later intake surface reads.
 *
 * A Request is not a work container. It converts into a Matter or a
 * Contract, or it resolves in its own thread (INT-007), so what it holds
 * is the ask itself — the four fixed basics, the values the type's form
 * collected, and the disposition.
 *
 * `number` is INT-002's global reference, the sibling of CTR-003's
 * contract sequence, rendered **R-###**. Its own Postgres identity
 * sequence, `GENERATED ALWAYS`, so the immutability is a database rule
 * rather than an application convention — no write path can set or
 * correct it.
 *
 * **The basics are not configuration.** Summary, Description,
 * Attachments, and Urgency are on every form by rule (the INT-002 M19/4
 * addendum), which is why three of them are columns here and none of
 * them is a `request_type_fields` row. Attachments are the fourth and
 * live in their own table, which lands with the upload build.
 *
 * **Everything the form collected beyond them is `custom_fields`,
 * keyed by field slug** — the same shape and the same rule as a
 * contract's, so conversion carries values across without re-keying
 * (INT-002). The slug is the field's immutable identity, so a value
 * outlives a rename and outlives detachment.
 *
 * `status` is fixed rather than admin-configurable: code branches on it
 * (INT-001 as revised by INT-007). Every Request is born `new`; the
 * other three arms are the Inbox's to write (M21).
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contracts, SEVERITY_LEVELS } from "./contracts.js";
import type { CustomFieldValue } from "./fields.js";
import { uuidPk } from "./helpers.js";
import { matters } from "./matters.js";
import { requestTypes } from "./request-types.js";

/**
 * INT-001's lifecycle as INT-007 revised it: a Request is open, or it
 * became a record, or it was answered in the thread, or it was turned
 * down. Code branches on every arm — the portal list badges it, the
 * Inbox filters on it — so it is a fixed enum, not a configurable list.
 */
export const REQUEST_STATUSES = ["new", "converted", "resolved", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const requests = pgTable(
  "requests",
  {
    id: uuidPk(),
    /** INT-002's immutable global reference, shown as R-###. */
    number: integer("number")
      .notNull()
      .generatedAlwaysAsIdentity({ name: "requests_number_seq", startWith: 1 }),
    /** The front door this came through (INT-002). No cascade: a
     * request type in use refuses hard delete, and an archived one
     * keeps naming the Requests it took. */
    requestTypeId: text("request_type_id")
      .notNull()
      .references(() => requestTypes.id),
    /** Who asked. Always the submitting session, never a body field —
     * a Business User creates Requests as themselves and no one else
     * (DD-013). */
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id),
    /** Born `new`; M21's disposition routes write the other three. */
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("new"),
    /** The one-line ask. Required on every form (INT-002). */
    summary: text("summary").notNull(),
    /** The ask in full. Required on every form, so the column is only
     * nullable for the rows a later import might bring. */
    description: text("description"),
    /** DES-018's severity ramp, requester-supplied, required on every
     * form. It maps 1:1 to `priority` at conversion; `risk` is never
     * requester-set (MTR-012). */
    urgency: text("urgency", { enum: SEVERITY_LEVELS }).notNull(),
    /** The form's collected values, keyed by field slug (INT-002) —
     * the contract column's shape, so conversion is a copy. */
    customFields: jsonb("custom_fields")
      .$type<Record<string, CustomFieldValue>>()
      .notNull()
      .default({}),
    /**
     * What conversion made of this Request (INT-006, DD-018). Both are
     * NULL while it is `new`, and at most one is ever set — a Request
     * becomes one record, not two.
     *
     * M22 added the `converted_matter_id` foreign key and index with the
     * Matter table; both conversion arms now have no-cascade references.
     */
    convertedMatterId: text("converted_matter_id").references(() => matters.id),
    /** The contract conversion made, if it made one. No cascade: a
     * contract is soft-deleted, never dropped. */
    convertedContractId: text("converted_contract_id").references(() => contracts.id),
    /** INT-006: "no" always arrives with a why. M21 writes it. */
    declinedReason: text("declined_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Soft delete, the house rule everywhere: NULL = live. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    // The identity sequence guarantees distinct numbers; the index is
    // what the number-keyed read (`/portal/requests/42`) uses. Unique
    // rather than plain, the contracts sequence's rule: the uniqueness
    // is what R-42 naming exactly one Request rests on, and a rule the
    // table states cannot be lost to a later backfill.
    uniqueIndex("requests_number_unique").on(table.number),
    // The requester's own list, which is the only list a Business User
    // ever sees (DD-013), newest first.
    index("requests_requester_idx").on(table.requesterId, table.createdAt),
    // The back-link, read from the record's end (CMT-001, M21/11): every
    // comment on a contract asks whether a Request converted into it, so
    // that the reply the requester was promised can follow the thread
    // onto the work. Without this the question is a scan of every
    // Request ever raised, on a table that only grows.
    index("requests_converted_contract_idx").on(table.convertedContractId),
    index("requests_converted_matter_idx").on(table.convertedMatterId),
    // "A Request becomes one record", stated as a shape rather than
    // left to the conversion route. Two targets would be two answers to
    // one question, and nothing could say which one the thread follows.
    check(
      "requests_converted_target_check",
      sql`num_nonnulls(${table.convertedMatterId}, ${table.convertedContractId}) <= 1`,
    ),
    // The two closed unions, held here for the reason every other
    // closed union in this schema is: an unknown value is a row no
    // surface can render and no filter can find.
    check(
      "requests_status_check",
      sql`${table.status} in ('new', 'converted', 'resolved', 'declined')`,
    ),
    check("requests_urgency_check", sql`${table.urgency} in ('low', 'medium', 'high', 'critical')`),
  ],
);

export type Request = typeof requests.$inferSelect;
