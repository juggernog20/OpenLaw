// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared TECH-012 behavioral contract exercised by deterministic and real
 * protocol adapters, including extraction variance and connection refusal.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiConfigError, type AiExtractionTarget, type AiProvider } from "../lib/ai/provider.js";

export interface AiProviderContractHarness {
  provider: AiProvider;
  refusingProvider: AiProvider;
  assertLastExtractionRequest?: () => void;
  stop?: () => Promise<void>;
}

const TARGETS: readonly AiExtractionTarget[] = [
  { slug: "term_type", type: "term_type", prompt: "The contract term type." },
  { slug: "effective_date", type: "date", prompt: "The date the contract starts." },
];

/** The one behavioral suite every AI provider implementation must pass. */
export function describeAiProviderContract(
  name: string,
  start: () => Promise<AiProviderContractHarness> | AiProviderContractHarness,
): void {
  describe(`${name} - AI provider contract`, () => {
    let harness: AiProviderContractHarness | undefined;

    beforeAll(async () => {
      harness = await start();
    });

    afterAll(async () => {
      await harness?.stop?.();
    });

    it("names a model", () => {
      expect(harness!.provider.model).not.toBe("");
    });

    it("makes a small successful probe", async () => {
      await expect(harness!.provider.probe()).resolves.toBeUndefined();
    });

    it("refuses bad credentials as a configuration fault with a message of its own", async () => {
      const refused = harness!.refusingProvider.probe();
      await expect(refused).rejects.toBeInstanceOf(AiConfigError);
      // The message is the adapter's, never the provider's body. A live
      // adapter names the status code; the fake names the key.
      await expect(refused).rejects.toMatchObject({
        name: "AiConfigError",
        message: expect.stringMatching(
          /^The provider refused the (request with HTTP \d+|API key)\.$/,
        ),
      });
    });

    it("carries the same Field formats for Conversion draft sources", async () => {
      await harness!.provider.extract(
        [
          {
            id: "request:1",
            revision: "1",
            label: "Request",
            kind: "request",
            text: "This Agreement starts on 1 September 2026 and has a fixed term.",
          },
        ],
        TARGETS,
      );
      harness!.assertLastExtractionRequest?.();
    });

    it("extracts one ordered object keyed by slug, including an answer with no evidence", async () => {
      const answers = await harness!.provider.extract(
        "This Agreement starts on 1 September 2026 and has a fixed term.",
        TARGETS,
      );
      expect(answers).toEqual([
        { slug: "term_type", value: "fixed", evidence: "has a fixed term" },
        { slug: "effective_date", value: "2026-09-01" },
      ]);
      harness!.assertLastExtractionRequest?.();
    });
  });
}
