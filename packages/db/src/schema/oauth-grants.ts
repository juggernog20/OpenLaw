// SPDX-License-Identifier: AGPL-3.0-only
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { McpToolset } from "@openlaw/shared";
import { uuidPk } from "./helpers.js";
import { users } from "./auth.js";
import { allowedClients } from "./allowed-clients.js";
import { oauthConsents } from "./oauth.js";

export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuidPk(),
    personId: text("person_id")
      .notNull()
      .references(() => users.id),
    allowedClientId: text("allowed_client_id")
      .notNull()
      .references(() => allowedClients.id, { onDelete: "cascade" }),
    toolsets: text("toolsets").array().$type<McpToolset[]>().notNull(),
    scope: text("scope", { enum: ["read", "write"] }).notNull(),
    consentId: text("consent_id").references(() => oauthConsents.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("oauth_grants_person_client_unique").on(t.personId, t.allowedClientId),
    index("oauth_grants_allowed_client_idx").on(t.allowedClientId),
    check("oauth_grants_scope_check", sql`${t.scope} in ('read', 'write')`),
    check("oauth_grants_toolsets_check", sql`cardinality(${t.toolsets}) > 0`),
  ],
);
export type OAuthGrant = typeof oauthGrants.$inferSelect;
