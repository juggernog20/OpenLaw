// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An Allowed Client is a Client an Administrator lets start the OAuth flow: a
 * published identity (metadata document URL) or a registered client (plugin client
 * id). Links map every plugin client id a Client uses, such as ChatGPT's
 * per-connection ids, back to its one Allowed Client row. See DD-029 and TECH-035.
 */
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidPk } from "./helpers.js";
import { users } from "./auth.js";
import { oauthClients } from "./oauth.js";

export const allowedClients = pgTable(
  "allowed_clients",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["published", "registered"] }).notNull(),
    // Null for registered rows; a published identity is its metadata document URL.
    metadataUrl: text("metadata_url").unique(),
    // Null for published rows and for a registered template with no secret generated yet.
    clientId: text("client_id").unique(),
    enabled: boolean("enabled").notNull().default(true),
    seeded: boolean("seeded").notNull().default(false),
    callbackUrls: text("callback_urls").array().notNull().default([]),
    // Null until an Administrator generates the secret.
    secretGeneratedAt: timestamp("secret_generated_at", { withTimezone: true }),
    registeredByClient: boolean("registered_by_client").notNull().default(false),
    // Null for seeded rows and for a Client that registered itself.
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("allowed_clients_kind_check", sql`${t.kind} in ('published', 'registered')`),
    check(
      "allowed_clients_identity_check",
      sql`(${t.kind} = 'published' and ${t.metadataUrl} is not null and ${t.clientId} is null) or (${t.kind} = 'registered' and ${t.metadataUrl} is null)`,
    ),
  ],
);

/** A published identity can resolve to many ChatGPT connection client ids. */
export const allowedClientLinks = pgTable(
  "allowed_client_links",
  {
    clientId: text("client_id")
      .primaryKey()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    allowedClientId: text("allowed_client_id")
      .notNull()
      .references(() => allowedClients.id, { onDelete: "cascade" }),
  },
  (t) => [index("allowed_client_links_allowed_idx").on(t.allowedClientId)],
);
