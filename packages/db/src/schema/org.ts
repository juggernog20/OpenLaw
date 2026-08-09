// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization-wide settings (TECH-008, DD-010/INT-001). A single row,
 * seeded by the migration that creates the table; the unique index on a
 * constant makes a second row unrepresentable. Columns arrive with the
 * features that read them (TECH-014) — auth policy first.
 */

import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const AUTH_MODES = ["built_in", "oidc"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const orgSettings = pgTable(
  "org_settings",
  {
    id: uuidPk(),
    authMode: text("auth_mode", { enum: AUTH_MODES }).notNull().default("built_in"),
    /** DD-010's portal floor; the host can close it where SSO-only is policy. */
    magicLinkEnabled: boolean("magic_link_enabled").notNull().default(true),
    /**
     * Lower-cased domains eligible for magic-link issuance and JIT
     * Business User provisioning. Empty means nobody — a fresh install
     * grants portal access only once an Administrator opens a domain.
     */
    allowedEmailDomains: jsonb("allowed_email_domains").$type<string[]>().notNull().default([]),
    /**
     * When the first-run onboarding wizard (SET-004) was finished or
     * skipped through. NULL routes the Administrator into the wizard on
     * login; set once, never cleared — the wizard is first-run only.
     */
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
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
    uniqueIndex("org_settings_singleton").on(sql`(true)`),
    check("org_settings_auth_mode_check", sql`${table.authMode} in ('built_in', 'oidc')`),
  ],
);

export type OrgSettings = typeof orgSettings.$inferSelect;
