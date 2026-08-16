// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One signing envelope on one contract, and the people it was sent to
 * (CTR-013, M15/2).
 *
 * An envelope is one round of signature on one version of a contract's
 * primary document. The provider holds the ceremony; this row is what
 * the record knows about it — which adapter carried it, the provider's
 * own id for it, where it stands, who sent it, what went out, and when.
 *
 * **Manual hand-off writes nothing here.** A team that never configures
 * a connector uploads the executed PDF and pins it by hand, exactly as
 * they do today (CTR-013), and their records hold no envelope row at
 * all. That is what the record's surfaces read to decide whether to
 * draw an envelope at all.
 *
 * **At most one live envelope per contract**, held by a partial unique
 * index on the `sent` status — the same shape M14 used for the
 * one-pending-ask rule. A declined or voided envelope blocks nothing:
 * the next round is a new row, and the earlier one stays on the record.
 *
 * **Adapter-keyed, like the connector it was sent through.** A record
 * sent through one provider is never voided through another, and the
 * webhook correlates on (`provider`, `provider_envelope_id`) rather than
 * on the provider's id alone.
 *
 * What is deliberately not here, and the step that brings it: nothing.
 * The columns the later M15 slices write — the decline or void reason,
 * the completion time, and the executed-copy fetch state — land with
 * this table rather than after it, because the one-transaction send has
 * to write a row the transition function can then move without a
 * migration between them.
 */

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";
import { documentVersions } from "./documents.js";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";
import { SIGNING_PROVIDERS } from "./signing-connectors.js";

/**
 * Where an envelope stands (CTR-013). One status for the envelope; who
 * has signed so far is provider-side detail v1 does not surface.
 *
 * Fixed rather than configurable for the reason the approval statuses
 * are: code branches on it — the live-envelope rule is `sent`, the
 * executed-copy fetch fires on `signed`, and the record draws one
 * DES-005 pill family per value.
 */
export const ENVELOPE_STATUSES = ["sent", "signed", "declined", "voided"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

/**
 * Where the executed copy stands (CTR-014), the M12 derived-artifact
 * pattern applied to a file another system holds.
 *
 * `pending` from the moment the envelope is sent, because nothing has
 * been fetched yet; `ready` once the executed PDF is on the version
 * chain; `failed` when the fetch gave up. A row that never completes
 * stays `pending` for good, which is the honest answer: no executed
 * copy was ever owed.
 */
export const EXECUTED_FETCH_STATES = ["pending", "ready", "failed"] as const;
export type ExecutedFetchState = (typeof EXECUTED_FETCH_STATES)[number];

export const contractEnvelopes = pgTable(
  "contract_envelopes",
  {
    id: uuidPk(),
    /** The record the signature is about. Cascade: the envelope is part
     * of the contract, and a contract that is gone has no envelopes. */
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    /** The adapter that carried it (CTR-013), recorded on the row so a
     * later void or status read goes back to the same one. */
    provider: text("provider", { enum: SIGNING_PROVIDERS }).notNull(),
    /** The provider's own id for the envelope — the correlation key for
     * every later call and for every inbound webhook delivery. */
    providerEnvelopeId: text("provider_envelope_id").notNull(),
    status: text("status", { enum: ENVELOPE_STATUSES }).notNull().default("sent"),
    /**
     * Which version of the primary document went out (CTR-014).
     *
     * Nullable, and set to NULL rather than blocking when that version
     * is erased: DOC-010's hard delete is an Administrator's lawful
     * erasure, and a row recording a past send must not be what stops
     * it. The executed pin (`documents.executed_version_id`) makes the
     * same trade for the same reason.
     */
    documentVersionId: text("document_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    /** Who sent it. No cascade, as everywhere a record names a person:
     * somebody is archived, never deleted (SET-005). */
    sentBy: text("sent_by")
      .notNull()
      .references(() => users.id),
    /** Why it was declined or voided, in the signer's or the voider's
     * own words; NULL for every other status. */
    reason: text("reason"),
    executedFetch: text("executed_fetch", { enum: EXECUTED_FETCH_STATES })
      .notNull()
      .default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    /** When it reached a terminal status; NULL while it is live. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** "The envelopes of this contract" — the read every signing
     * surface on the record makes. */
    index("contract_envelopes_contract_idx").on(table.contractId),
    /**
     * The correlation key an inbound delivery and the reconciliation
     * sweep both look an envelope up by. Unique **per adapter**: two
     * providers may mint the same id, and a delivery from one must
     * never land on the other's row.
     */
    uniqueIndex("contract_envelopes_provider_id_idx").on(table.provider, table.providerEnvelopeId),
    /**
     * At most one **live** envelope per contract (CTR-013), as the
     * database's own last word behind the check the send route makes
     * under the contract's row lock.
     *
     * Partial on purpose: a declined or voided envelope blocks nothing,
     * so the next round goes out as easily as the first and the earlier
     * envelope stays on the record.
     */
    uniqueIndex("contract_envelopes_live_idx")
      .on(table.contractId)
      .where(sql`status = 'sent'`),
    /**
     * `provider`, `status`, and `executed_fetch` hold only the values
     * CTR-013 defines. Drizzle's `{ enum }` is a TypeScript narrowing
     * and emits no constraint, so without these the database accepts
     * any text — and the paired checks below would not catch it: an
     * unknown status with a `completed_at` satisfies the completion
     * pair. Every other closed union in this schema is guarded the same
     * way.
     */
    check("contract_envelopes_provider_check", sql`provider in ('docusign')`),
    check(
      "contract_envelopes_status_check",
      sql`status in ('sent', 'signed', 'declined', 'voided')`,
    ),
    check(
      "contract_envelopes_executed_fetch_check",
      sql`executed_fetch in ('pending', 'ready', 'failed')`,
    ),
    /** A terminal status and its time arrive together, and a live
     * envelope carries neither. The row prints "—" for a live
     * envelope's completion rather than guessing, so a row with a time
     * and no ending would be unreadable. */
    check("contract_envelopes_completed_at", sql`(status = 'sent') = (completed_at is null)`),
    /** A reason belongs to a decline or a void and to nothing else. A
     * reason on a signed envelope would be a sentence with no act
     * behind it. */
    check(
      "contract_envelopes_reason_status",
      sql`reason is null or status in ('declined', 'voided')`,
    ),
  ],
);

export type ContractEnvelope = typeof contractEnvelopes.$inferSelect;

/**
 * One person asked to sign one envelope (CTR-013).
 *
 * They live in their own table because the record **renders** them: the
 * envelope row answers "who was asked to sign this", and a JSON column
 * could not be read back as rows.
 *
 * A signer is a name and an email typed into the send dialog, not a
 * user of this install and not a counterparty contact. The person on
 * the other side of a deal has no account here, and the envelope has to
 * reach them anyway.
 *
 * **Every signer is asked in parallel** (CTR-013 v1): `signing_order`
 * records the order they were entered, so the row draws them back as
 * they were typed, and it is not a routing order. Sequential routing is
 * provider-side detail v1 does not surface.
 */
export const contractEnvelopeSigners = pgTable(
  "contract_envelope_signers",
  {
    id: uuidPk(),
    /** Cascade: a signer is part of an envelope and has no life without
     * one. */
    envelopeId: text("envelope_id")
      .notNull()
      .references(() => contractEnvelopes.id, { onDelete: "cascade" }),
    /** What the signer is called, as the sender typed it. */
    name: text("name").notNull(),
    /** Where the invitation went. Stored verbatim: it is what the
     * record has to be able to show a week later. */
    email: text("email").notNull(),
    /** 1..n, in the order the sender entered them. A display order, not
     * a routing order — every signer is asked at once. */
    signingOrder: integer("signing_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** "The signers of this envelope" — the only read there is. */
    index("contract_envelope_signers_envelope_idx").on(table.envelopeId),
    /** One row per position, so two writers cannot both take position 2
     * and leave the row undrawable in a stable order. */
    uniqueIndex("contract_envelope_signers_order_idx").on(table.envelopeId, table.signingOrder),
    check("contract_envelope_signers_order_check", sql`signing_order >= 1`),
  ],
);

export type ContractEnvelopeSigner = typeof contractEnvelopeSigners.$inferSelect;
