// SPDX-License-Identifier: AGPL-3.0-only

import { describeAiProviderContract } from "../../testing/ai-provider-contract.js";
import { createFakeAiProvider, FAKE_VALID_AI_KEY } from "./fake.js";

describeAiProviderContract("deterministic fake", () => ({
  provider: createFakeAiProvider({
    answers: {
      term_type: { value: "fixed", evidence: "has a fixed term" },
      effective_date: { value: "2026-09-01" },
    },
  }),
  refusingProvider: createFakeAiProvider({ apiKey: `${FAKE_VALID_AI_KEY}-wrong` }),
}));
