// SPDX-License-Identifier: AGPL-3.0-only
/** Durable actor-scoped proposals before Request conversion (INT-008). */
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ConversionSuggestion, ConversionAttachmentRead } from "@openlaw/shared";
import { uuidPk } from "./helpers.js";
import { requests } from "./requests.js";
import { users } from "./auth.js";

export const conversionDrafts = pgTable(
  "conversion_drafts",
  {
    id: uuidPk(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    targetModule: text("target_module", { enum: ["matter", "contract"] }).notNull(),
    targetTypeId: text("target_type_id").notNull(),
    snapshot: text("snapshot").notNull(),
    state: text("state", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    model: text("model"),
    suggestions: jsonb("suggestions")
      .$type<Record<string, ConversionSuggestion>>()
      .notNull()
      .default({}),
    conflicts: jsonb("conflicts")
      .$type<Record<string, ConversionSuggestion>>()
      .notNull()
      .default({}),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    attachmentReads: jsonb("attachment_reads")
      .$type<ConversionAttachmentRead[]>()
      .notNull()
      .default([]),
    failure: text("failure"),
    leaseAt: timestamp("lease_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("conversion_drafts_state_check", sql`${t.state} in ('pending', 'ready', 'failed')`),
    check("conversion_drafts_module_check", sql`${t.targetModule} in ('matter', 'contract')`),
    uniqueIndex("conversion_drafts_snapshot_idx").on(
      t.requestId,
      t.actorId,
      t.targetModule,
      t.targetTypeId,
      t.snapshot,
    ),
    index("conversion_drafts_pending_idx").on(t.state, t.startedAt),
  ],
);
