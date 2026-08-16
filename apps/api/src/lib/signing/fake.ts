// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The deterministic signing provider — the stand-in used everywhere
 * DocuSign is not the thing under test.
 *
 * It is not a mock. It records no expectations and answers no questions
 * about what it was called with: a suite states what should have
 * happened to the record, and reads that from the API and the activity
 * table. What the fake does hold is the one thing a real provider holds
 * and a stateless double could not — the envelopes themselves — because
 * "send, then complete it, then watch the executed copy land" is the
 * milestone's whole sentence.
 *
 * It is **scriptable**: a suite completes, declines, or voids an
 * envelope on demand, which is how the parts of CTR-013 that wait on a
 * signer are exercised without waiting on one.
 *
 * It is honest about the refusals a caller has to branch on — unknown
 * envelope, an executed copy asked for before there is one, a forged
 * webhook — because those decide code paths. It is deliberately not
 * honest about DocuSign's own shapes: the JWT grant, the Connect body,
 * and the REST payloads are the driver's half of the contract, and they
 * are proved in the driver's own suite.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { SigningEnvironment, SigningProviderKey } from "@openlaw/db";
import {
  ENVELOPE_STATUSES,
  EnvelopeNotFoundError,
  SigningConfigError,
  SigningRefusedError,
  WebhookSignatureError,
  type ConnectionCheck,
  type EnvelopeSigner,
  type EnvelopeState,
  type EnvelopeStatus,
  type SendEnvelopeInput,
  type SentEnvelope,
  type SigningProvider,
  type WebhookDelivery,
} from "./provider.js";

/** The header the fake signs its deliveries with — the same name
 * DocuSign Connect uses, so the route under test reads one header name
 * whichever provider answered. */
export const FAKE_SIGNATURE_HEADER = "x-docusign-signature-1";

/** The integration key a suite must configure for the fake to accept
 * the credentials. Anything else is refused, so "test connection fails"
 * is a scriptable outcome and not an outage. */
export const FAKE_VALID_INTEGRATION_KEY = "openlaw-fake-integration-key";

/** What a successful connection test answers. Fixed, so a suite states
 * the account name it expects rather than reading one back. */
export const FAKE_ACCOUNT: ConnectionCheck = {
  accountId: "fake-account-0001",
  accountName: "OpenLaw Fake Account",
  userEmail: "integration@openlaw.example",
};

/** One envelope the fake is holding. */
interface FakeEnvelope {
  id: string;
  status: EnvelopeStatus;
  signers: EnvelopeSigner[];
  fileName: string;
  subject: string;
  /** The bytes that were sent, which the executed copy is derived from. */
  source: Buffer;
  reason?: string;
  completedAt?: Date;
}

/** What a fake instance may vary. */
export interface FakeSigningOptions {
  environment?: SigningEnvironment;
  /** The credential the fake accepts; a suite passes a wrong one to act
   * out an Administrator who mistyped the integration key. */
  integrationKey?: string;
  /** The secret its webhook deliveries are signed with. */
  webhookSecret?: string;
}

/** The bytes of the executed copy the fake answers for an envelope. */
export function fakeExecutedPdf(providerEnvelopeId: string): Buffer {
  return Buffer.from(
    `%PDF-1.7\n% openlaw-fake-signing: executed ${providerEnvelopeId}\n%%EOF\n`,
    "utf8",
  );
}

/** Everything a stream yields, as one buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * The deterministic provider. One instance per resolution, exactly as
 * the real driver is built per resolution — but a suite holds on to it
 * to script the envelopes it sent.
 */
export class FakeSigningProvider implements SigningProvider {
  readonly provider: SigningProviderKey = "docusign";
  readonly environment: SigningEnvironment;

  private readonly integrationKey: string;
  private readonly webhookSecret: string;
  private readonly envelopes = new Map<string, FakeEnvelope>();
  private counter = 0;

  constructor(options: FakeSigningOptions = {}) {
    this.environment = options.environment ?? "demo";
    this.integrationKey = options.integrationKey ?? FAKE_VALID_INTEGRATION_KEY;
    this.webhookSecret = options.webhookSecret ?? "openlaw-fake-webhook-secret";
  }

  async testConnection(): Promise<ConnectionCheck> {
    await Promise.resolve();
    if (this.integrationKey !== FAKE_VALID_INTEGRATION_KEY) {
      throw new SigningConfigError(
        "The provider refused the connector's credentials. Check the integration key, " +
          "the user ID, and the RSA key.",
      );
    }
    return FAKE_ACCOUNT;
  }

  async sendEnvelope(input: SendEnvelopeInput): Promise<SentEnvelope> {
    if (input.signers.length === 0) {
      throw new SigningRefusedError("An envelope needs at least one signer.");
    }
    const source = await collect(input.document);
    // Sequential, so a suite reading two envelope ids can tell which
    // came first without sorting by anything.
    this.counter += 1;
    const id = `fake-envelope-${String(this.counter).padStart(4, "0")}`;
    this.envelopes.set(id, {
      id,
      status: "sent",
      signers: input.signers,
      fileName: input.fileName,
      subject: input.subject,
      source,
    });
    return { providerEnvelopeId: id };
  }

  // The three reads below are `async` rather than promise-returning so
  // that an unknown envelope rejects instead of throwing where the
  // caller awaits. The interface promises a rejection, and a caller
  // that only catches one would otherwise miss it.
  async voidEnvelope(providerEnvelopeId: string, reason: string): Promise<void> {
    const envelope = this.require(providerEnvelopeId);
    if (envelope.status !== "sent") {
      throw new SigningRefusedError("That envelope is no longer live and cannot be voided.");
    }
    envelope.status = "voided";
    envelope.reason = reason;
    envelope.completedAt = new Date();
    await Promise.resolve();
  }

  async readEnvelope(providerEnvelopeId: string): Promise<EnvelopeState> {
    const envelope = await Promise.resolve(this.require(providerEnvelopeId));
    return {
      status: envelope.status,
      ...(envelope.reason !== undefined ? { reason: envelope.reason } : {}),
      ...(envelope.completedAt !== undefined ? { completedAt: envelope.completedAt } : {}),
    };
  }

  async fetchExecutedDocument(providerEnvelopeId: string): Promise<Readable> {
    const envelope = await Promise.resolve(this.require(providerEnvelopeId));
    if (envelope.status !== "signed") {
      throw new SigningRefusedError("That envelope has no executed copy — it is not signed.");
    }
    return Readable.from([fakeExecutedPdf(envelope.id)]);
  }

  verifyWebhook(body: Buffer, headers: Readonly<Record<string, string>>): WebhookDelivery {
    const expected = createHmac("sha256", this.webhookSecret).update(body).digest();
    const offered = Buffer.from(headers[FAKE_SIGNATURE_HEADER] ?? "", "base64");
    if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
      throw new WebhookSignatureError("The delivery is not signed by this install's Connect key.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      throw new WebhookSignatureError("The delivery body is not JSON.");
    }
    // The fake's own wire shape: the delivery, as JSON. Dates arrive as
    // strings, which is the one place JSON and the interface differ.
    const delivery = parsed as {
      providerEnvelopeId?: unknown;
      status?: unknown;
      reason?: unknown;
      completedAt?: unknown;
    };
    if (
      typeof delivery.providerEnvelopeId !== "string" ||
      typeof delivery.status !== "string" ||
      !(ENVELOPE_STATUSES as readonly string[]).includes(delivery.status)
    ) {
      throw new WebhookSignatureError("The delivery body is not an envelope event.");
    }
    return {
      providerEnvelopeId: delivery.providerEnvelopeId,
      status: delivery.status as EnvelopeStatus,
      ...(typeof delivery.reason === "string" ? { reason: delivery.reason } : {}),
      ...(typeof delivery.completedAt === "string"
        ? { completedAt: new Date(delivery.completedAt) }
        : {}),
    };
  }

  // ---- Scripting: what a suite does instead of waiting for a signer ----

  /** Signs the envelope, as its last signer would. */
  complete(providerEnvelopeId: string): void {
    const envelope = this.require(providerEnvelopeId);
    envelope.status = "signed";
    envelope.completedAt = new Date();
  }

  /** Declines the envelope with a signer's stated reason. */
  decline(providerEnvelopeId: string, reason: string): void {
    const envelope = this.require(providerEnvelopeId);
    envelope.status = "declined";
    envelope.reason = reason;
    envelope.completedAt = new Date();
  }

  /** The envelope ids the fake has been sent, oldest first. */
  sentEnvelopeIds(): string[] {
    return [...this.envelopes.keys()];
  }

  /** The signers one envelope went to. */
  signersOf(providerEnvelopeId: string): EnvelopeSigner[] {
    return this.require(providerEnvelopeId).signers;
  }

  /** The bytes one envelope carried, so a suite can prove the right
   * version went out without opening the provider's internals. */
  documentOf(providerEnvelopeId: string): Buffer {
    return this.require(providerEnvelopeId).source;
  }

  /** A delivery body plus the header that signs it, as the provider
   * would push it. This is how a suite drives the webhook route. */
  signedDelivery(delivery: WebhookDelivery): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify(delivery);
    return {
      body,
      headers: {
        [FAKE_SIGNATURE_HEADER]: createHmac("sha256", this.webhookSecret)
          .update(body)
          .digest("base64"),
      },
    };
  }

  private require(providerEnvelopeId: string): FakeEnvelope {
    const envelope = this.envelopes.get(providerEnvelopeId);
    if (!envelope) throw new EnvelopeNotFoundError("No envelope has that id.");
    return envelope;
  }
}

/** Builds the deterministic provider. */
export function createFakeSigningProvider(options: FakeSigningOptions = {}): FakeSigningProvider {
  return new FakeSigningProvider(options);
}
