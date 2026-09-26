// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One signing envelope on one contract, and the people it is for
 * (CTR-013, M15/2, #1171).
 *
 * An envelope is one round of signature on one exact version of a
 * contract's primary document. The provider holds the ceremony; this row
 * is what the record knows about it — which adapter carried it, the
 * provider's own id for it, where it stands, who prepared or sent it,
 * what it carries, and when.
 *
 * **The row is written before the provider is called** (#1171). A send
 * or a preparation first commits a `preparing` row that holds the
 * intent: source document and version, subject, signers, preparer,
 * provider account and environment, idempotency key, and a provider
 * transaction id. The provider's envelope id and the sent time arrive
 * later, so both columns are nullable, and check constraints say which
 * statuses may lack them.
 *
 * **Manual hand-off writes nothing here.** A team that never configures
 * a connector uploads the executed PDF and pins it by hand, exactly as
 * they do today (CTR-013), and their records hold no envelope row at
 * all. That is what the record's surfaces read to decide whether to
 * draw an envelope at all.
 *
 * **At most one local live reservation per contract**, held by a partial unique
 * index on `LIVE_ENVELOPE_STATUSES` (`preparing`, `draft`, `sent`) —
 * excluding externally restored rounds. All live rounds still block new creation. A
 * declined, voided, or failed round blocks nothing: the next round is a
 * new row, and the earlier one stays on the record.
 *
 * **Adapter-keyed, like the connector it was sent through.** A record
 * sent through one provider is never voided through another, and the
 * webhook correlates on (`provider`, `provider_envelope_id`) rather than
 * on the provider's id alone.
 *
 * M15/5 adds `executed_version_id`, the version this round filed. The
 * fetch state says *whether* the executed copy landed; this says *which
 * file it is*, and the two are different questions.
 */

import { LIVE_ENVELOPE_STATUSES } from "@openlaw/shared";
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
import { contracts } from "./contracts.js";
import { documents, documentVersions } from "./documents.js";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";
import { SIGNING_PROVIDERS } from "./signing-connectors.js";

/**
 * Where an envelope stands (CTR-013). One status for the envelope; who
 * has signed so far is provider-side detail v1 does not surface.
 *
 * Fixed rather than configurable for the reason the approval statuses
 * are: code branches on it — the live-envelope rule includes preparations, the
 * executed-copy fetch fires on `signed`, and the record draws one
 * DES-005 pill family per value.
 */
export const ENVELOPE_STATUSES = [
  "preparing",
  "draft",
  "preparation_failed",
  "discarded",
  "sent",
  "signed",
  "declined",
  "voided",
] as const;
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
    providerEnvelopeId: text("provider_envelope_id"),
    /** The primary document the version was chosen from. NULL on rows
     * sent before #1171, which name only their version. */
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    /** The retained subject. NULL on historical rounds and after Signer erasure. */
    subject: text("subject"),
    /** The caller's key for one request; unique per contract. */
    idempotencyKey: text("idempotency_key"),
    /** A hash of the request the key first named, so a reuse with other
     * inputs is refused as a conflict rather than answered as a match. */
    requestFingerprint: text("request_fingerprint"),
    /** Our own id for the creation, sent to the provider with it, so an
     * envelope whose answer was lost can be looked up later. */
    providerTransactionId: text("provider_transaction_id"),
    /** The provider account and environment the round was created in. */
    providerAccountId: text("provider_account_id"),
    providerEnvironment: text("provider_environment"),
    /** How far external creation got. `uncertain` means we never heard
     * back, and the round stays reserved until the outcome is known.
     * NULL on rows sent before #1171. */
    preparationState: text("preparation_state", {
      enum: ["pending", "uncertain", "created", "failed"],
    }),
    /** Original operation intent. NULL on reservations made before #1174. */
    creationKind: text("creation_kind", { enum: ["draft", "send"] }),
    creationStatusId: text("creation_status_id"),
    creationStatusRevision: integer("creation_status_revision"),
    /** Durable recovery allowance. No request retry resets these fields. */
    recoveryAttempts: integer("recovery_attempts").notNull().default(0),
    /** NULL means no scheduled claim. An unstopped preparing row then uses
     * the creation grace; settled or stopped rows are not eligible. */
    nextRecoveryAt: timestamp("next_recovery_at", { withTimezone: true }).default(
      sql`now() + interval '15 minutes'`,
    ),
    /** NULL means there is no operator stop. Status and nextRecoveryAt
     * still decide eligibility; it does not mean recovery is complete. */
    recoveryStopped: text("recovery_stopped", {
      enum: ["lookup_expired", "attempts_exhausted", "identity_missing"],
    }),
    /** Provider schedule, read without modifying its workflow. */
    scheduled: boolean("scheduled").notNull().default(false),
    /** A discarded round restored outside OpenLaw does not reclaim another reservation. */
    externallyRestored: boolean("externally_restored").notNull().default(false),
    confirmationPending: boolean("confirmation_pending").notNull().default(false),
    launchClaimExpiresAt: timestamp("launch_claim_expires_at", { withTimezone: true }),
    /** Next permitted provider status check, shared by all worker replicas. */
    nextReconcileAt: timestamp("next_reconcile_at", { withTimezone: true }),
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
    /** The preparer, retained for Void permission and executed-copy authorship.
     * Users are archived, never deleted (SET-005). */
    sentBy: text("sent_by")
      .notNull()
      .references(() => users.id),
    /** Why it was declined or voided, in the signer's or the voider's
     * own words; NULL for every other status. */
    reason: text("reason"),
    executedFetch: text("executed_fetch", { enum: EXECUTED_FETCH_STATES })
      .notNull()
      .default("pending"),
    /**
     * The version **this round** filed on the chain (M15/5, CTR-014).
     *
     * It is not the same fact as `documents.executed_version_id`, and
     * that is why it is its own column. The pin names the one version
     * the record calls the signed copy, and a team moves it by hand; a
     * chain can hold two rounds both of kind `executed`, and this row
     * has to keep saying which of them **it** produced. The envelope
     * row draws that file, and it would draw the wrong one if it read
     * the pin.
     *
     * NULL until the fetch lands, and NULL again if that version is
     * erased — DOC-010's hard delete is an Administrator's lawful
     * erasure, and a row recording a past round must not be what stops
     * it. `document_version_id` beside it makes the same trade.
     */
    executedVersionId: text("executed_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
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
     * One local live reservation per Contract (CTR-013). Externally restored
     * rounds retain their provider status without reclaiming this reservation.
     * The creation routes check all live rows under the Contract lock.
     *
     * Partial on purpose: a declined or voided envelope blocks nothing,
     * so the next round goes out as easily as the first and the earlier
     * envelope stays on the record.
     */
    uniqueIndex("contract_envelopes_live_idx")
      .on(table.contractId)
      .where(
        sql.raw(
          `status in (${LIVE_ENVELOPE_STATUSES.map((status) => `'${status}'`).join(", ")}) and not externally_restored`,
        ),
      ),
    /** One request per key on a contract, and one creation per
     * transaction id. */
    uniqueIndex("contract_envelopes_idempotency_idx").on(table.contractId, table.idempotencyKey),
    uniqueIndex("contract_envelopes_transaction_idx").on(table.providerTransactionId),
    check(
      "contract_envelopes_creation_kind_check",
      sql`creation_kind is null or creation_kind in ('draft', 'send')`,
    ),
    check(
      "contract_envelopes_creation_revision_check",
      sql`creation_status_revision is null or creation_status_revision >= 0`,
    ),
    check("contract_envelopes_recovery_attempts_check", sql`recovery_attempts >= 0`),
    check(
      "contract_envelopes_recovery_stopped_check",
      sql`recovery_stopped is null or recovery_stopped in ('lookup_expired', 'attempts_exhausted', 'identity_missing')`,
    ),
    check(
      "contract_envelopes_creation_check",
      sql`preparation_state is null or preparation_state in ('pending', 'uncertain', 'created', 'failed')`,
    ),
    /** Only a round the provider has not yet named may lack its id. */
    check(
      "contract_envelopes_provider_required",
      sql`status in ('preparing', 'preparation_failed') or provider_envelope_id is not null`,
    ),
    /** A sent time exactly when the round was sent. A draft has none. */
    check(
      "contract_envelopes_sent_time",
      sql`(status in ('preparing', 'draft', 'preparation_failed', 'discarded')) = (sent_at is null)`,
    ),
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
      sql`status in ('preparing', 'draft', 'preparation_failed', 'discarded', 'sent', 'signed', 'declined', 'voided')`,
    ),
    check(
      "contract_envelopes_executed_fetch_check",
      sql`executed_fetch in ('pending', 'ready', 'failed')`,
    ),
    /** A terminal status and its time arrive together, and a live
     * envelope carries neither. The row prints "—" for a live
     * envelope's completion rather than guessing, so a row with a time
     * and no ending would be unreadable. */
    check(
      "contract_envelopes_completed_at",
      sql`(status in ('preparing', 'draft', 'sent')) = (completed_at is null)`,
    ),
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
 * A Signer is resolved from a user of this install or entered as an
 * external name and email address. Both are retained on the round.
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
    /**
     * One address, one signer — the database backstop for the rule the
     * send route already refuses on (CTR-013's #391 addendum). Naming
     * somebody twice asks the provider to invite one inbox twice, and
     * the row that comes back is then two rows nothing can tell apart:
     * the address is a signer's whole identity here, since the erasure
     * path finds a signer by it and nothing else.
     *
     * Case-insensitive, because that is how the send compares addresses
     * and how the erasure matches them, and because `users_email_unique`
     * reads an address the same way. The column itself stays verbatim —
     * what the record has to show a week later is what the sender typed.
     */
    uniqueIndex("contract_envelope_signers_email_idx").on(
      table.envelopeId,
      sql`lower(${table.email})`,
    ),
    check("contract_envelope_signers_order_check", sql`signing_order >= 1`),
  ],
);

export type ContractEnvelopeSigner = typeof contractEnvelopeSigners.$inferSelect;

/** One expiring return correlation per browser launch. Only its hash is stored. */
export const envelopeLaunches = pgTable("envelope_launches", {
  stateHash: text("state_hash").primaryKey(),
  envelopeId: text("envelope_id")
    .notNull()
    .references(() => contractEnvelopes.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  providerAccountId: text("provider_account_id").notNull(),
  providerEnvironment: text("provider_environment").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** NULL means this launch has not been consumed. Expiry still limits its use. */
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
