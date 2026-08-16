// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing connector (CTR-013, TECH-013): the credentials one
 * e-signature provider is reached with.
 *
 * The row is org data, not deployment environment. An Administrator
 * configures it at runtime in Settings → Organization → Integrations,
 * and every use reads it live (the mailer-resolver pattern), so a
 * rotation applies to the next call with no restart.
 *
 * **Adapter-keyed.** `provider` is the adapter behind the row, unique,
 * `docusign` in v1. A second provider is a second row, not a second
 * table — which is what keeps CTR-013's provider-agnostic promise a
 * configuration fact rather than a migration.
 *
 * **A configured connector can be turned off, and it can be taken
 * out.** `disabled_at` is the reversible half: the row stays, the
 * credentials stay, and every surface answers as an unconfigured
 * install does. Deleting the row is the other half, and it is refused
 * while any envelope is still out — that one is not reversible, and an
 * envelope with no credentials left to reach it can never be voided or
 * converged.
 *
 * **The two secrets are encrypted at rest** (TECH-022). They are
 * declared with `encryptedText`, so the value is sealed on the way to
 * Postgres and opened on the way back with a key that lives outside
 * the database — a `pg_dump` of this table mints no JWTs and forges no
 * webhook deliveries. Both columns are also write-only through the
 * API: they are pasted to rotate and never read back.
 */

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { encryptedText } from "../secrets.js";
import { uuidPk } from "./helpers.js";

/** The adapters a connector row may key on. DocuSign ships first (CTR-013). */
export const SIGNING_PROVIDERS = ["docusign"] as const;
export type SigningProviderKey = (typeof SIGNING_PROVIDERS)[number];

/**
 * Which DocuSign estate the connector talks to. The two differ by host
 * and by account, so it is configuration rather than a build flag: a
 * team rehearses on the demo estate and moves the same install to
 * production by changing this field (TECH-013).
 */
export const SIGNING_ENVIRONMENTS = ["demo", "production"] as const;
export type SigningEnvironment = (typeof SIGNING_ENVIRONMENTS)[number];

export const signingConnectors = pgTable(
  "signing_connectors",
  {
    id: uuidPk(),
    /** The adapter this row configures; one row per adapter. */
    provider: text("provider", { enum: SIGNING_PROVIDERS }).notNull(),
    environment: text("environment", { enum: SIGNING_ENVIRONMENTS }).notNull(),
    /** DocuSign's integration key — the OAuth client id of the app. */
    integrationKey: text("integration_key").notNull(),
    /**
     * The provider-side user the integration signs as (TECH-013's
     * integration user). Named `api_user_id` rather than `user_id`
     * because it is a GUID in DocuSign's directory, never a row in
     * ours.
     */
    apiUserId: text("api_user_id").notNull(),
    /**
     * The RSA private key, PEM, that signs the JWT assertions.
     * Write-only through the API and encrypted at rest (TECH-022).
     */
    privateKey: encryptedText("private_key").notNull(),
    /**
     * The DocuSign Connect HMAC secret. Encrypted at rest (TECH-022),
     * write-only, and **not nullable**: the webhook is the install's
     * first unauthenticated inbound write path, so a connector without
     * this secret is refused at save time and no install ever answers
     * unsigned deliveries.
     */
    webhookSecret: encryptedText("webhook_secret").notNull(),
    /**
     * When an Administrator turned the connector off, or NULL while it
     * is on (CTR-013, [#273](https://github.com/juggernog20/OpenLaw/issues/273)).
     *
     * A nullable timestamp rather than a boolean, the `archived_at`
     * shape every taxonomy table already uses: "off since Tuesday" is
     * a fact worth keeping, and "off" alone is not.
     *
     * **A disabled row resolves to nothing**, exactly as a missing one
     * does. That is what puts the manual hand-off back within reach: an
     * install that configured a connector and wants the zero-config
     * path again turns it off, and every surface answers as it did
     * before the connector existed. The credentials stay for the
     * re-enable, which is the difference from deleting the row.
     */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("signing_connectors_provider_idx").on(table.provider),
    check("signing_connectors_provider_check", sql`${table.provider} in ('docusign')`),
    check(
      "signing_connectors_environment_check",
      sql`${table.environment} in ('demo', 'production')`,
    ),
  ],
);

export type SigningConnector = typeof signingConnectors.$inferSelect;
