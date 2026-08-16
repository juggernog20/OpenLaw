// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The deterministic signing provider against the shared contract, plus
 * the few facts that are its own: what a suite reads back about a send,
 * and that scripting an envelope is what moves it.
 *
 * The fake is what every behaviour suite runs, so holding it to the
 * same contract the driver runs is what stops those suites from proving
 * something no real provider does.
 */

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { describeSigningContract } from "../../testing/signing-contract.js";
import { createFakeSigningProvider, FAKE_ACCOUNT } from "./fake.js";
import { SigningUnavailableError, WebhookSignatureError } from "./provider.js";

describeSigningContract("the deterministic fake", () => {
  const provider = createFakeSigningProvider();
  return {
    adapter: "docusign" as const,
    provider,
    refusingProvider: createFakeSigningProvider({ integrationKey: "wrong-key" }),
    signDelivery: (delivery) => provider.signedDelivery(delivery),
    completeEnvelope: (id) => provider.complete(id),
    declineEnvelope: (id, reason) => provider.decline(id, reason),
  };
});

describe("the deterministic fake's own facts", () => {
  /** One envelope, sent through a fresh fake. */
  async function sendOne() {
    const provider = createFakeSigningProvider();
    const { providerEnvelopeId } = await provider.sendEnvelope({
      document: Readable.from([Buffer.from("%PDF-1.7\ndraft five\n%%EOF\n")]),
      fileName: "msa-v5.pdf",
      subject: "Please sign the MSA",
      signers: [{ name: "Dana Signer", email: "dana@counterparty.example" }],
    });
    return { provider, providerEnvelopeId };
  }

  it("answers a fixed account, so a suite states what it expects", async () => {
    await expect(createFakeSigningProvider().testConnection()).resolves.toEqual(FAKE_ACCOUNT);
  });

  it("keeps the bytes and the signers a send carried", async () => {
    const { provider, providerEnvelopeId } = await sendOne();
    expect(provider.documentOf(providerEnvelopeId).toString("utf8")).toContain("draft five");
    expect(provider.signersOf(providerEnvelopeId)).toEqual([
      { name: "Dana Signer", email: "dana@counterparty.example" },
    ]);
  });

  it("lists the envelopes it was sent, oldest first", async () => {
    const { provider, providerEnvelopeId } = await sendOne();
    const second = await provider.sendEnvelope({
      document: Readable.from([Buffer.from("%PDF-1.7\ndraft six\n%%EOF\n")]),
      fileName: "msa-v6.pdf",
      subject: "Please sign the MSA",
      signers: [{ name: "Dana Signer", email: "dana@counterparty.example" }],
    });
    expect(provider.sentEnvelopeIds()).toEqual([providerEnvelopeId, second.providerEnvelopeId]);
  });

  it("only moves an envelope when a suite scripts it", async () => {
    const { provider, providerEnvelopeId } = await sendOne();
    await expect(provider.readEnvelope(providerEnvelopeId)).resolves.toMatchObject({
      status: "sent",
    });
    provider.complete(providerEnvelopeId);
    await expect(provider.readEnvelope(providerEnvelopeId)).resolves.toMatchObject({
      status: "signed",
    });
  });

  it("answers an outage with the seam's transient failure, and keeps its envelopes", async () => {
    const { provider, providerEnvelopeId } = await sendOne();
    provider.outage();
    await expect(provider.readEnvelope(providerEnvelopeId)).rejects.toBeInstanceOf(
      SigningUnavailableError,
    );
    // Verification reaches nothing, so an outage cannot stop it: it is
    // arithmetic over bytes already in hand.
    const signed = provider.signedDelivery({ providerEnvelopeId, status: "signed" });
    expect(provider.verifyWebhook(Buffer.from(signed.body, "utf8"), signed.headers)).toMatchObject({
      providerEnvelopeId,
      status: "signed",
    });
    // Transient means the moment, not the account: the same instance
    // answers for the same envelope once it is reachable again.
    provider.online();
    await expect(provider.readEnvelope(providerEnvelopeId)).resolves.toMatchObject({
      status: "sent",
    });
  });

  it("signs deliveries with its own secret alone", () => {
    const provider = createFakeSigningProvider({ webhookSecret: "one-secret" });
    const other = createFakeSigningProvider({ webhookSecret: "another-secret" });
    const signed = other.signedDelivery({ providerEnvelopeId: "e1", status: "signed" });
    expect(() => provider.verifyWebhook(Buffer.from(signed.body, "utf8"), signed.headers)).toThrow(
      WebhookSignatureError,
    );
  });
});
