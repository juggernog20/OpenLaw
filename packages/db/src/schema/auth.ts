// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auth tables (TECH-008). Naming per docs/decision-records/SCHEMA.md;
 * enum columns are text + CHECK per its conventions. better-auth maps
 * onto these via model/field mapping — its CLI never touches this schema.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const USER_ROLES = [
  "administrator",
  "legal_team_member",
  "contributor",
  "business_user",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The three shipped UI themes (DES-001); Light is the default (DES-002). */
export const THEMES = ["light", "warm", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const users = pgTable(
  "users",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull().default("business_user"),
    // UI theme preference (#44): follows the user across browsers.
    theme: text("theme", { enum: THEMES }).notNull().default("light"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // twoFactor-plugin column (nullable per its schema, like the admin
    // columns below); flipped by TOTP enrolment/disable, read by the
    // credential sign-in hook to decide whether to challenge.
    twoFactorEnabled: boolean("two_factor_enabled").default(false),
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
    // Unique on lower(email): every write path normalizes to lower case,
    // and this makes the database reject a casing-variant duplicate that
    // a direct adapter write could otherwise sneak past the application.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    check(
      "users_role_check",
      sql`${table.role} in ('administrator', 'legal_team_member', 'contributor', 'business_user')`,
    ),
    check("users_theme_check", sql`${table.theme} in ('light', 'warm', 'dark')`),
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
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    // Postgres does not index FK columns automatically; this one backs
    // both cascade deletes and "revoke all sessions of a user".
    index("sessions_user_id_idx").on(table.userId),
  ],
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
    index("accounts_user_id_idx").on(table.userId),
  ],
);

/**
 * Runtime-registered BYO IdPs (TECH-008). One row per identity provider,
 * created through the admin-only registration route; the OIDC config JSON
 * carries the client secret (DB-at-rest storage accepted for v1 — flagged
 * for a future secrets-encryption pass in the auth spec).
 *
 * `domain_verified` is the sso plugin's provider-trust flag: only a
 * trusted provider may link a sign-in to a pre-existing user by email.
 * OpenLaw sets it at registration — an Administrator registering the
 * provider IS the domain-trust decision in a single-tenant install; the
 * plugin's DNS-TXT verification flow is never exposed. `saml_config` and
 * `organization_id` are demanded by the plugin's model but carry no
 * product semantics (SAML and the organization plugin are out of scope).
 */
export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: uuidPk(),
    /** Stable slug identifying the provider in sign-in and callback flows. */
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    /** Email domain(s) served by this IdP; comma-separated for multi-domain. */
    domain: text("domain").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    organizationId: text("organization_id"),
    domainVerified: boolean("domain_verified").notNull().default(false),
    /** The registering Administrator (no cascade: the IdP outlives them). */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sso_providers_provider_id_unique").on(table.providerId)],
);

/**
 * TOTP second factor (TECH-008). One row per enrolled user, owned by the
 * twoFactor plugin: `secret` is the symmetrically encrypted TOTP seed and
 * `backup_codes` the encrypted recovery codes — both encrypted with the
 * auth secret, never returned by any endpoint. `verified` stays false
 * until the user proves the first code, so a half-finished enrolment
 * never challenges (or locks out) a sign-in. The failure counter and
 * `locked_until` implement the plugin's account-level lockout: too many
 * failed verifications lock the factor across challenges until the
 * timestamp passes.
 */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: uuidPk(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(false),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One factor per user is the plugin's working invariant (enable deletes
  // any prior row before inserting); unique makes the database hold it
  // even under concurrent enrolments.
  (table) => [uniqueIndex("two_factors_user_id_unique").on(table.userId)],
);

/** Short-lived tokens (magic links, set-password); values stored hashed. */
export const verifications = pgTable(
  "verifications",
  {
    id: uuidPk(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Every redemption looks tokens up by identifier, and this table grows
  // with traffic.
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);
