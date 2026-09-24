// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-035 Tool call metadata. Arguments, results and record ids never enter this
 * ledger. A reserved row becomes a completed call with an outcome and duration.
 */

import { index, integer, pgTable, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidPk } from "./helpers.js";
import { users } from "./auth.js";

export const mcpToolCalls = pgTable(
  "mcp_tool_calls",
  {
    id: uuidPk(),
    personId: text("person_id")
      .notNull()
      .references(() => users.id),
    // Also identifies OAuth credentials when that path lands in M41.
    credentialId: text("credential_id").notNull(),
    clientName: text("client_name").notNull(),
    tool: text("tool").notNull(),
    outcome: text("outcome").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mcp_tool_calls_credential_time_idx").on(t.credentialId, t.createdAt),
    index("mcp_tool_calls_created_at_idx").on(t.createdAt),
    check("mcp_tool_calls_duration_check", sql`${t.durationMs} >= 0`),
  ],
);
