// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The deflection links (INT-004): the ordered list behind the "Before
 * you submit..." panel, managed by the Administrator under Intake
 * Settings, Deflection links (ST13). A link is a label over a URL. The
 * label reads as the answer, the URL is where the answer lives. The
 * placement decides who sees it.
 *
 * A null request type is the portal home. A link with no request type
 * shows on the portal home panel, so everybody sees it whatever they
 * came to ask. A link naming a request type shows on that form instead.
 * The two placements are one nullable column because they are one
 * decision, and INT-004 wrote it that way.
 *
 * A link is removed, never archived. Nothing points at a link and there
 * is no history to keep, so the row leaves outright. That is why there
 * is no `archived_at` here and no `slug`: a link has no machine identity
 * anything else refers to.
 *
 * Deleting the request type takes its links with it (`on delete
 * cascade`). The sibling target FKs on `request_types` demote with
 * `on delete set null`, and that is the wrong move here. A link's
 * placement is its audience, so setting it null would take a link the
 * Administrator put on one form and publish it to every requester on
 * the portal home. Widening an audience is not a demotion. Cascade
 * matches `request_type_fields`, the other child of `request_types`.
 * The type carries its form definition and its deflection panel alike,
 * and a hard delete is only reachable for a type nothing has used.
 *
 * The URL is stored exactly as the Administrator entered it (INT-004).
 * The API validates it as an absolute http/https address and normalizes
 * nothing. The ST13 row renders it without its scheme.
 */

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { requestTypes } from "./request-types.js";
import { uuidPk } from "./helpers.js";
import { knowledgeItems } from "./knowledge-items.js";

export const intakeLinks = pgTable(
  "intake_links",
  {
    id: uuidPk(),
    /** What the panel reads as, for example "NDA FAQ — when you don't need legal". */
    label: text("label").notNull(),
    /** The external target, or NULL when this points at Knowledge. */
    url: text("url"),
    /** The internal target, or NULL for an external URL. */
    knowledgeItemId: text("knowledge_item_id").references(() => knowledgeItems.id, {
      onDelete: "set null",
    }),
    /** Where the link shows: NULL = the portal home panel, a request
     * type = that type's form only (INT-004). */
    requestTypeId: text("request_type_id").references(() => requestTypes.id, {
      onDelete: "cascade",
    }),
    /** Panel position, 1-based; reorder rewrites the whole list. */
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for a writer that forgets to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The portal reads one placement's panel at a time (M20), and the
    // cascade delete looks the same way up.
    index("intake_links_request_type_id_idx").on(table.requestTypeId),
    index("intake_links_knowledge_item_id_idx").on(table.knowledgeItemId),
    check(
      "intake_links_target_check",
      sql`num_nonnulls(${table.url}, ${table.knowledgeItemId}) = 1`,
    ),
  ],
);

export type IntakeLink = typeof intakeLinks.$inferSelect;
