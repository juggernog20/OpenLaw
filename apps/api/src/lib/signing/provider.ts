// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing seam (CTR-013): one narrow interface over an e-signature
 * provider, with a driver behind it.
 *
 * It is built on the storage-adapter and doc-engine precedents, and for
 * the same reason: CTR-013 keeps OpenLaw provider-neutral, and other
 * adapters (Documenso, DocuSeal, Dropbox Sign, Adobe Sign) are parked
 * behind this interface. Nothing here names DocuSign, an account, a
 * REST path, a tab, or a recipient role — an interface shaped around
 * one vendor's API could not carry the next one.
 *
 * Two rules hold for every implementation:
 *
 * - **The provider holds the envelope, we hold the record.** A call
 *   answers what the provider says; what OpenLaw stores about it, and
 *   under which row, is the caller's decision.
 * - **The provider never writes to us.** It returns values and streams.
 *   Files, activity, and status transitions belong to the caller.
 *
 * The failures below are split by what a caller does about them, the
 * doc-engine split. {@link SigningConfigError},
 * {@link SigningRefusedError}, {@link EnvelopeNotFoundError}, and
 * {@link WebhookSignatureError} are **terminal** — a retry sends the
 * same bad credentials, the same rejected payload, or the same forged
 * delivery. {@link SigningUnavailableError} and
 * {@link SigningTimeoutError} are **transient** — an unreachable or
 * slow provider is exactly what a retry heals.
 */

import type { Readable } from "node:stream";
import type { SigningEnvironment, SigningProviderKey } from "@openlaw/db";

/** Base class of every failure this interface defines. */
export class SigningError extends Error {}

/**
 * The provider refused our credentials, or the stored credentials
 * cannot be used at all (an unreadable private key). Terminal: an
 * Administrator has to fix the connector.
 */
export class SigningConfigError extends SigningError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SigningConfigError";
  }
}

/**
 * The provider understood the request and said no — a malformed
 * envelope, a signer it will not accept, a void of an envelope that has
 * already completed. Terminal: the same request would be refused again.
 */
export class SigningRefusedError extends SigningError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SigningRefusedError";
  }
}

/** No envelope with that provider id. Terminal — a webhook for an
 * envelope we do not know is ignored, not retried. */
export class EnvelopeNotFoundError extends SigningError {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeNotFoundError";
  }
}

/**
 * A webhook delivery whose HMAC does not verify, or whose body is not
 * the shape the provider sends. Terminal, and deliberately one error
 * for both: the route answers a forged delivery and a malformed one the
 * same way, and telling a caller which it was would be telling an
 * attacker too.
 */
export class WebhookSignatureError extends SigningError {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/** The provider could not be reached, or failed for its own reasons. Transient. */
export class SigningUnavailableError extends SigningError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SigningUnavailableError";
  }
}

/** The call ran past its bound. Transient. */
export class SigningTimeoutError extends SigningError {
  constructor(message: string) {
    super(message);
    this.name = "SigningTimeoutError";
  }
}

/** The envelope states CTR-013 tracks. One status for the envelope; who
 * has signed so far is provider-side detail v1 does not surface. */
export const ENVELOPE_STATUSES = ["sent", "signed", "declined", "voided"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

/** One person asked to sign. All signers are asked in parallel in v1 —
 * there is no routing order. */
export interface EnvelopeSigner {
  name: string;
  email: string;
}

/** What goes out: the bytes, what to call them, and who signs. */
export interface SendEnvelopeInput {
  /** The document version's bytes, as the storage adapter opens them. */
  document: Readable;
  /** The file name the signers see, extension included. */
  fileName: string;
  /** The subject line of the provider's own invitation. */
  subject: string;
  signers: EnvelopeSigner[];
}

/** What the provider answers when it accepts an envelope. */
export interface SentEnvelope {
  /** The provider's own id — the correlation key for every later call. */
  providerEnvelopeId: string;
}

/** An envelope as the provider currently sees it. */
export interface EnvelopeState {
  status: EnvelopeStatus;
  /** Why it was declined or voided; absent for every other status. */
  reason?: string;
  /** When it reached a terminal status, if the provider says. */
  completedAt?: Date;
}

/** One verified webhook delivery, reduced to what the record needs. */
export interface WebhookDelivery {
  providerEnvelopeId: string;
  status: EnvelopeStatus;
  reason?: string;
  completedAt?: Date;
}

/** What a successful connection test found — the pane shows it, so an
 * Administrator sees *which* account they just proved. */
export interface ConnectionCheck {
  /** The provider account the credentials authenticate into. */
  accountName: string;
  /** That account's provider-side id. */
  accountId: string;
  /** The integration user the envelopes will be sent as. */
  userEmail: string;
}

/**
 * The one signing seam. Built per use from the stored connector row
 * (the mailer-resolver pattern) and injected through the app factory,
 * so application code only ever sees this type.
 */
export interface SigningProvider {
  /** Which adapter this is. The envelope row records it, so a record
   * sent through one provider is never voided through another. */
  readonly provider: SigningProviderKey;

  /** Which estate the credentials point at (TECH-013's demo/production). */
  readonly environment: SigningEnvironment;

  /**
   * Authenticates and reads back the account the credentials reach.
   *
   * This is what the Settings pane's Test connection button calls.
   * Rejects with {@link SigningConfigError} when the provider refuses
   * the credentials, and with {@link SigningUnavailableError} or
   * {@link SigningTimeoutError} when it could not be asked.
   */
  testConnection(): Promise<ConnectionCheck>;

  /**
   * Sends one document to its signers and answers the provider's id
   * for the envelope.
   *
   * Rejects with {@link SigningRefusedError} when the provider will not
   * take the envelope as described.
   */
  sendEnvelope(input: SendEnvelopeInput): Promise<SentEnvelope>;

  /**
   * Withdraws a live envelope, recording the reason with the provider.
   *
   * Rejects with {@link EnvelopeNotFoundError} for an id the provider
   * does not know, and with {@link SigningRefusedError} for an envelope
   * that is past withdrawal.
   */
  voidEnvelope(providerEnvelopeId: string, reason: string): Promise<void>;

  /**
   * Asks the provider where an envelope stands. This is what the
   * reconciliation sweep calls, so an install the provider cannot reach
   * still converges.
   *
   * Rejects with {@link EnvelopeNotFoundError} for an unknown id.
   */
  readEnvelope(providerEnvelopeId: string): Promise<EnvelopeState>;

  /**
   * Opens the executed document of a completed envelope for reading.
   *
   * Rejects with {@link EnvelopeNotFoundError} for an unknown id, and
   * with {@link SigningRefusedError} for an envelope that has no
   * executed copy — one still out, declined, or voided.
   */
  fetchExecutedDocument(providerEnvelopeId: string): Promise<Readable>;

  /**
   * Verifies one inbound webhook delivery and reduces it to the facts
   * the record needs.
   *
   * `body` is the exact bytes as delivered — verification is over the
   * raw request, so a re-serialized JSON object would not verify.
   *
   * Throws {@link WebhookSignatureError} when the signature does not
   * verify or the body is not a delivery this provider sends. It throws
   * rather than rejects because verification is arithmetic over bytes
   * already in hand — nothing is asked of the network.
   */
  verifyWebhook(body: Buffer, headers: Readonly<Record<string, string>>): WebhookDelivery;
}
