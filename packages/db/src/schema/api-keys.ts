// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-029 API key requests and TECH-035 better-auth credentials. Toolsets and scope
 * stay on the approved request; the credential stores its hash, lifetime and usage.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { McpToolset } from "@openlaw/shared";
import { uuidPk } from "./helpers.js";
import { users } from "./auth.js";
const time = (name: string) => timestamp(name, { withTimezone: true });

/** better-auth 1.7's api-key schema. Revocation disables a key; history is retained. */
export const apikeys = pgTable(
  "api_keys",
  {
    id: uuidPk(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => users.id),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: time("last_refill_at"),
    enabled: boolean("enabled").notNull().default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: time("last_request"),
    expiresAt: time("expires_at"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (t) => [
    uniqueIndex("api_keys_key_unique").on(t.key),
    index("api_keys_owner_idx").on(t.referenceId),
    index("api_keys_expiry_idx").on(t.expiresAt),
  ],
);

export const apiKeyRequests = pgTable(
  "api_key_requests",
  {
    id: uuidPk(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id),
    clientName: text("client_name").notNull(),
    toolsets: jsonb("toolsets").$type<McpToolset[]>().notNull(),
    scope: text("scope", { enum: ["read", "write"] }).notNull(),
    note: text("note"),
    status: text("status", { enum: ["pending", "approved", "denied", "cancelled"] })
      .notNull()
      .default("pending"),
    keyId: text("key_id").references(() => apikeys.id),
    // Explicit seal/open keeps ordinary reads from decrypting the once-shown key.
    sealedKey: text("sealed_key"),
    decidedBy: text("decided_by").references(() => users.id),
    decisionNote: text("decision_note"),
    decidedAt: time("decided_at"),
    revokedAt: time("revoked_at"),
    expiryAuditedAt: time("expiry_audited_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("api_key_requests_owner_idx").on(t.requesterId),
    index("api_key_requests_status_idx").on(t.status),
    uniqueIndex("api_key_requests_key_unique").on(t.keyId),
    check("api_key_requests_scope_check", sql`${t.scope} in ('read', 'write')`),
    check(
      "api_key_requests_status_check",
      sql`${t.status} in ('pending', 'approved', 'denied', 'cancelled')`,
    ),
    check(
      "api_key_requests_approval_check",
      sql`(${t.status} = 'approved') = (${t.keyId} is not null)`,
    ),
  ],
);
