// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { findSavedAiKey } from "./ai-connector-config";

const saved = {
  id: "custom-key",
  preset: "custom" as const,
  protocol: "openai_chat_completions" as const,
  baseUrl: "https://private.test/v1/?b=2&a=1#old",
  inUse: false,
  updatedAt: "2026-09-20T12:00:00.000Z",
};

describe("matching a pending destination to a Saved key", () => {
  it("normalizes both URL spellings and returns the Saved key", () => {
    expect(
      findSavedAiKey([saved], { ...saved, baseUrl: "https://private.test/v1?a=1&b=2#new" }),
    ).toBe(saved);
  });

  it.each([
    { preset: "openai" },
    { protocol: "gemini" },
    { baseUrl: "https://elsewhere.test/v1?a=1&b=2" },
    { baseUrl: "https://private.test/v2?a=1&b=2" },
    { baseUrl: "https://private.test/v1?a=2&b=2" },
    { baseUrl: "unfinished" },
  ])("refuses a different or unfinished destination: %o", (pending) => {
    expect(findSavedAiKey([saved], { ...saved, ...pending })).toBeUndefined();
  });
});
