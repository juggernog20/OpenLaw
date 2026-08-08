// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auth tables (TECH-008). Naming per docs/decision-records/SCHEMA.md;
 * enum columns are text + CHECK per its conventions. better-auth maps
 * onto these via model/field mapping — its CLI never touches this schema.
 */

import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const USER_ROLES = [
  "administrator",
  "legal_team_member",
  "contributor",
  "business_user",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable(
  "users",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull().default("business_user"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // Admin-plugin columns (nullable per its schema; unban writes NULLs).
    // No product semantics attach to bans yet — deliberately out of scope.
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check(
      "users_role_check",
      sql`${table.role} in ('administrator', 'legal_team_member', 'contributor', 'business_user')`,
    ),
  ],
);

/** Server-side sessions (TECH-008: sessions are ours in both auth modes). */
export const sessions = pgTable(
  "sessions",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // References users.id; the admin plugin dictates the name, so it
    // deviates from SCHEMA.md's `<entity>_id` FK convention.
    impersonatedBy: text("impersonated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sessions_token_unique").on(table.token)],
);

/** Credential and OIDC-subject rows per user (TECH-008). */
export const accounts = pgTable(
  "accounts",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // A provider subject identifies exactly one account: one credential row
  // per user, and no second user can ever claim someone else's OIDC subject.
  (table) => [
    uniqueIndex("accounts_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

/** Short-lived tokens (magic links, set-password); values stored hashed. */
export const verifications = pgTable("verifications", {
  id: uuidPk(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
