// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization-wide settings (TECH-008, DD-010/INT-001). A single row,
 * seeded by the migration that creates the table; the unique index on a
 * constant makes a second row unrepresentable. Columns arrive with the
 * features that read them (TECH-014) — auth policy first.
 */

import { MCP_DEFAULT_TOOLSET_CEILING, type McpToolset } from "@openlaw/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../secrets.js";
import { uuidPk } from "./helpers.js";

export const AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES = [
  "none",
  "every_use",
  "once_per_auto_doc",
  "once",
] as const;

export const AUTH_MODES = ["built_in", "oidc"] as const;
export type AuthenticationOptions = {
  password: boolean;
  magicLink: boolean;
  sso: boolean;
  requireTwoFactor: boolean;
};
export type AuthenticationPolicy = {
  legal: AuthenticationOptions;
  business: AuthenticationOptions;
};

export type AuthMode = (typeof AUTH_MODES)[number];

export const DEFAULT_AUTO_DOC_ACKNOWLEDGEMENT_TEXT =
  "I agree not to edit the generated document. I will contact Legal if changes are needed.";

export const orgSettings = pgTable(
  "org_settings",
  {
    id: uuidPk(),
    allowLegalApproverGroupOverride: boolean("allow_legal_approver_group_override")
      .notNull()
      .default(true),
    authMode: text("auth_mode", { enum: AUTH_MODES }).notNull().default("built_in"),
    authenticationPolicy: jsonb("authentication_policy").$type<AuthenticationPolicy>(),
    requireTwoFactor: boolean("require_two_factor").notNull().default(false),
    /** DD-010's portal floor; the host can close it where SSO-only is policy. */
    magicLinkEnabled: boolean("magic_link_enabled").notNull().default(true),
    /**
     * Lower-cased domains eligible for magic-link issuance and JIT
     * Business User provisioning. Empty means nobody — a fresh install
     * grants portal access only once an Administrator opens a domain.
     */
    allowedEmailDomains: jsonb("allowed_email_domains").$type<string[]>().notNull().default([]),
    autoDocAcknowledgementText: text("auto_doc_acknowledgement_text")
      .notNull()
      .default(DEFAULT_AUTO_DOC_ACKNOWLEDGEMENT_TEXT),
    autoDocAcknowledgementFrequency: text("auto_doc_acknowledgement_frequency", {
      enum: AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES,
    })
      .notNull()
      .default("once_per_auto_doc"),
    /** Org identity (SET-001 General pane). Empty until an Administrator names the org. */
    name: text("name").notNull().default(""),
    /** The org logo as a data: URI; NULL until one is uploaded. */
    logo: text("logo"),
    /** DES-093: 48×48 PNG bytes as base64 for inline email attachments. */
    emailLogoPng: text("email_logo_png"),
    currenciesInUse: jsonb("currencies_in_use").$type<string[]>().notNull().default([]),
    /** BCP 47 tag; the display locale until per-user locales exist (DES-013). */
    defaultLocale: text("default_locale").notNull().default("en-US"),
    /** IANA zone name; the display timezone until a user sets their own (DES-014). */
    defaultTimezone: text("default_timezone").notNull().default("UTC"),
    commentWordsInEmail: boolean("comment_words_in_email").notNull().default(true),
    /**
     * NOT-004's one reminder-offset list: how many days ahead of a
     * tracked date the morning round fires, seeded `7 / 1 / day-of`.
     *
     * **One list for every tracked date** — key dates, notice deadlines,
     * and expiries alike. It is admin-tunable rather than fixed because
     * nothing branches on the numbers (the configurable-over-fixed rule).
     * It is the organization's default: a person may set their own list
     * on `users.reminder_offset_days` (NOT-004 addendum, 2026-09-24).
     *
     * Day-granular whole numbers, because a deadline is a day and not a
     * moment (SCHEMA.md, DES-014): the round compares civil dates, and a
     * fractional offset would have nothing to compare against.
     *
     * **`jsonb` rather than a table**, which is the shape
     * `allowed_email_domains` above already takes and for the same
     * reason: this column is an ordered list of scalars, read whole on
     * every round and written whole by one pane, with nothing hanging
     * off any one of its entries.
     */
    reminderOffsetDays: jsonb("reminder_offset_days")
      .$type<number[]>()
      .notNull()
      .default([7, 1, 0]),
    /**
     * When the first-run onboarding wizard (SET-004) was finished or
     * skipped through. NULL routes the Administrator into the wizard on
     * login; set once, never cleared — the wizard is first-run only.
     */
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    /** Review changes no settings. This records its first acknowledgement (SET-004). */
    onboardingReviewedTypesAt: timestamp("onboarding_reviewed_types_at", { withTimezone: true }),
    /**
     * App-saved SMTP relay URL (TECH-011 revision), credentials inline —
     * the same single-URL shape as the SMTP_URL env variable, one mental
     * model across both carriers. Write-only through the API: it embeds
     * the credential and is never echoed back. Ignored entirely while the
     * environment pins SMTP — env always wins over app configuration.
     * Encrypted at rest (TECH-022): the password is inline in the URL,
     * so a database backup would otherwise hand over the ability to
     * send mail as the organisation.
     */
    smtpUrl: encryptedText("smtp_url"),
    /** From-address paired with smtpUrl — the SMTP_FROM shape. */
    smtpFrom: text("smtp_from"),
    /** SQL NULL means no stored pair. The resolver creates both keys together. */
    vapidPublicKey: text("vapid_public_key"),
    /** SQL NULL accompanies an absent public key; generated pairs are sealed under TECH-022. */
    vapidPrivateKey: encryptedText("vapid_private_key"),
    /** Startup settings, including write-only object-store credentials. */
    advancedSettings: encryptedText("advanced_settings"),
    mcpEnabled: boolean("mcp_enabled").notNull().default(false),
    mcpLegalApiKeysEnabled: boolean("mcp_legal_api_keys_enabled").notNull().default(false),
    mcpBusinessApiKeysEnabled: boolean("mcp_business_api_keys_enabled").notNull().default(false),
    mcpLegalOAuthClientsEnabled: boolean("mcp_legal_oauth_clients_enabled")
      .notNull()
      .default(false),
    mcpBusinessOAuthClientsEnabled: boolean("mcp_business_oauth_clients_enabled")
      .notNull()
      .default(false),
    mcpDynamicClientRegistrationEnabled: boolean("mcp_dynamic_client_registration_enabled")
      .notNull()
      .default(false),
    mcpToolsetCeiling: jsonb("mcp_toolset_ceiling")
      .$type<McpToolset[]>()
      .notNull()
      .default([...MCP_DEFAULT_TOOLSET_CEILING]),
    mcpReadOnly: boolean("mcp_read_only").notNull().default(false),
    mcpApiKeyLifetimeDays: integer("mcp_api_key_lifetime_days").notNull().default(90),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // $onUpdate keeps the audit trail honest for writers that forget to
    // set it — application code owns every write here, unlike the
    // better-auth tables where the adapter maintains updatedAt.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "org_settings_mcp_api_key_lifetime_check",
      sql`${table.mcpApiKeyLifetimeDays} between 1 and 365`,
    ),
    check(
      "org_settings_auto_doc_acknowledgement_frequency_check",
      sql`${table.autoDocAcknowledgementFrequency} in ('none', 'every_use', 'once_per_auto_doc', 'once')`,
    ),
    uniqueIndex("org_settings_singleton").on(sql`(true)`),
    check("org_settings_auth_mode_check", sql`${table.authMode} in ('built_in', 'oidc')`),
  ],
);

export type OrgSettings = typeof orgSettings.$inferSelect;
