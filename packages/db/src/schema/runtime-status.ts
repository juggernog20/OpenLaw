// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Each process reports the configuration it actually started with. */
export const runtimeStatus = pgTable("runtime_status", {
  id: text("id").primaryKey(),
  role: text("role").notNull(),
  configDigest: text("config_digest").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
});
