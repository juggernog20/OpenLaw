// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared signing-provider contract suite (CTR-013, TECH-014).
 *
 * There is one suite, and every implementation behind
 * {@link SigningProvider} must pass it: the deterministic fake, and the
 * DocuSign driver against a stub that speaks DocuSign's shapes. A
 * behaviour only one of them has is not in here — this file is the
 * definition of what "a signing provider" means in OpenLaw, so
 * application code can hold one mental model of signing and be right on
 * every install.
 *
 * The suite asks the interface for facts and reads them back through
 * the interface. It never opens an implementation's internals, and it
 * never asserts a provider-specific id, host, or payload — those belong
 * to the driver's own file.
 */

import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EnvelopeNotFoundError,
  SigningConfigError,
  SigningRefusedError,
  WebhookSignatureError,
  type EnvelopeSigner,
  type SigningProvider,
  type WebhookDelivery,
} from "../lib/signing/provider.js";

/** What an implementation hands the suite to be held to the contract. */
export interface SigningContractHarness {
  /** The adapter this implementation is, as the interface names it.
   * Stated by the harness rather than assumed by the suite: the
   * contract is what "a signing provider" means, not what DocuSign is. */
  adapter: SigningProvider["provider"];
  /** A provider built from credentials the counterpart accepts. */
  provider: SigningProvider;
  /**
   * A provider built from credentials the counterpart refuses. The
   * connection test is what an Administrator presses to find out, so
   * both answers are part of the contract.
   */
  refusingProvider: SigningProvider;
  /** Signs a delivery body the way the counterpart signs its own. */
  signDelivery: (delivery: WebhookDelivery) => {
    body: string;
    headers: Record<string, string>;
  };
  /** Marks an envelope signed, as its last signer would. */
  completeEnvelope: (providerEnvelopeId: string) => Promise<void> | void;
  /** Marks an envelope declined, with the signer's reason. */
  declineEnvelope: (providerEnvelopeId: string, reason: string) => Promise<void> | void;
  /** Tears down whatever the harness stood up. */
  stop?: () => Promise<void>;
}

/** The signers every send in this suite goes to. */
const SIGNERS: EnvelopeSigner[] = [
  { name: "Dana Signer", email: "dana@counterparty.example" },
  { name: "Rowan Signer", email: "rowan@counterparty.example" },
];

/** A tiny PDF, as the storage adapter would open one. */
function document(): Readable {
  return Readable.from([Buffer.from("%PDF-1.7\n% openlaw signing contract suite\n%%EOF\n")]);
}

/** Sends one envelope and answers the provider's id for it. */
async function send(provider: SigningProvider): Promise<string> {
  const sent = await provider.sendEnvelope({
    document: document(),
    fileName: "agreement.pdf",
    subject: "Please sign the agreement",
    signers: SIGNERS,
  });
  return sent.providerEnvelopeId;
}

/** An id no implementation has ever minted. */
const UNKNOWN_ENVELOPE_ID = "openlaw-contract-suite-unknown-envelope";

/**
 * Runs the contract against one implementation.
 *
 * `name` names the implementation in the suite output, and `start`
 * builds the harness once for the whole run.
 */
export function describeSigningContract(
  name: string,
  start: () => Promise<SigningContractHarness> | SigningContractHarness,
  options: { startTimeoutMs?: number } = {},
): void {
  describe(`${name} — signing provider contract`, () => {
    // Unset until `start` resolves, so a failed startup leaves the
    // original error standing rather than a type lie behind it.
    let harness: SigningContractHarness | undefined;

    beforeAll(async () => {
      harness = await start();
    }, options.startTimeoutMs);

    afterAll(async () => {
      await harness?.stop?.();
    });

    /** The harness, once `beforeAll` has built it. */
    function held(): SigningContractHarness {
      if (!harness) throw new Error("the signing contract harness did not start");
      return harness;
    }

    it("names the adapter it is and the estate it points at", () => {
      expect(held().provider.provider).toBe(held().adapter);
      expect(["demo", "production"]).toContain(held().provider.environment);
    });

    it("authenticates and names the account the credentials reach", async () => {
      const check = await held().provider.testConnection();
      expect(check.accountId).not.toBe("");
      expect(check.accountName).not.toBe("");
      expect(check.userEmail).not.toBe("");
    });

    it("refuses bad credentials terminally, so a retry is pointless", async () => {
      await expect(held().refusingProvider.testConnection()).rejects.toBeInstanceOf(
        SigningConfigError,
      );
    });

    it("sends an envelope and answers an id that reads back as live", async () => {
      const id = await send(held().provider);
      expect(id).not.toBe("");
      await expect(held().provider.readEnvelope(id)).resolves.toMatchObject({ status: "sent" });
    });

    it("mints a distinct id per envelope", async () => {
      const first = await send(held().provider);
      const second = await send(held().provider);
      expect(first).not.toBe(second);
    });

    it("refuses an envelope with no signers", async () => {
      await expect(
        held().provider.sendEnvelope({
          document: document(),
          fileName: "agreement.pdf",
          subject: "Please sign the agreement",
          signers: [],
        }),
      ).rejects.toBeInstanceOf(SigningRefusedError);
    });

    it("reads a completed envelope as signed", async () => {
      const id = await send(held().provider);
      await held().completeEnvelope(id);
      await expect(held().provider.readEnvelope(id)).resolves.toMatchObject({ status: "signed" });
    });

    it("reads a declined envelope with its reason", async () => {
      const id = await send(held().provider);
      await held().declineEnvelope(id, "The indemnity cap is wrong.");
      const state = await held().provider.readEnvelope(id);
      expect(state.status).toBe("declined");
      expect(state.reason).toBe("The indemnity cap is wrong.");
    });

    it("voids a live envelope and reads it back voided with its reason", async () => {
      const id = await send(held().provider);
      await held().provider.voidEnvelope(id, "Superseded by a new draft.");
      const state = await held().provider.readEnvelope(id);
      expect(state.status).toBe("voided");
      expect(state.reason).toBe("Superseded by a new draft.");
    });

    it("refuses to void an envelope that is already finished", async () => {
      const id = await send(held().provider);
      await held().completeEnvelope(id);
      await expect(held().provider.voidEnvelope(id, "Too late.")).rejects.toBeInstanceOf(
        SigningRefusedError,
      );
    });

    it("opens the executed document of a signed envelope", async () => {
      const id = await send(held().provider);
      await held().completeEnvelope(id);
      const bytes = await buffer(await held().provider.fetchExecutedDocument(id));
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    });

    it("has no executed document for an envelope still out", async () => {
      const id = await send(held().provider);
      await expect(held().provider.fetchExecutedDocument(id)).rejects.toBeInstanceOf(
        SigningRefusedError,
      );
    });

    it("does not know an envelope it never sent", async () => {
      await expect(held().provider.readEnvelope(UNKNOWN_ENVELOPE_ID)).rejects.toBeInstanceOf(
        EnvelopeNotFoundError,
      );
    });

    it("accepts a delivery it signed and reduces it to the record's facts", () => {
      const signed = held().signDelivery({
        providerEnvelopeId: "envelope-under-test",
        status: "signed",
      });
      const delivery = held().provider.verifyWebhook(
        Buffer.from(signed.body, "utf8"),
        signed.headers,
      );
      expect(delivery.providerEnvelopeId).toBe("envelope-under-test");
      expect(delivery.status).toBe("signed");
    });

    it("carries a decline's reason through the delivery", () => {
      const signed = held().signDelivery({
        providerEnvelopeId: "envelope-under-test",
        status: "declined",
        reason: "Not our paper.",
      });
      const delivery = held().provider.verifyWebhook(
        Buffer.from(signed.body, "utf8"),
        signed.headers,
      );
      expect(delivery.status).toBe("declined");
      expect(delivery.reason).toBe("Not our paper.");
    });

    it("refuses a delivery whose body was changed after signing", () => {
      const signed = held().signDelivery({
        providerEnvelopeId: "envelope-under-test",
        status: "signed",
      });
      const tampered = Buffer.from(
        signed.body.replace("envelope-under-test", "somebody-elses-envelope"),
        "utf8",
      );
      expect(() => held().provider.verifyWebhook(tampered, signed.headers)).toThrow(
        WebhookSignatureError,
      );
    });

    it("refuses a delivery with no signature at all", () => {
      const signed = held().signDelivery({
        providerEnvelopeId: "envelope-under-test",
        status: "signed",
      });
      expect(() => held().provider.verifyWebhook(Buffer.from(signed.body, "utf8"), {})).toThrow(
        WebhookSignatureError,
      );
    });
  });
}
