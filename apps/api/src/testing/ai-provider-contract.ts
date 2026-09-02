// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiConfigError, type AiExtractionTarget, type AiProvider } from "../lib/ai/provider.js";

export interface AiProviderContractHarness {
  provider: AiProvider;
  refusingProvider: AiProvider;
  assertLastExtractionRequest?: () => void;
  stop?: () => Promise<void>;
}

const TARGETS: readonly AiExtractionTarget[] = [
  { slug: "term_type", prompt: "The contract term type." },
  { slug: "effective_date", prompt: "The date the contract starts." },
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

    it("prints the provider reason when credentials are refused", async () => {
      const refused = harness!.refusingProvider.probe();
      await expect(refused).rejects.toMatchObject({
        name: "AiConfigError",
        message: expect.stringContaining("API key"),
      });
      await expect(refused).rejects.toBeInstanceOf(AiConfigError);
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
