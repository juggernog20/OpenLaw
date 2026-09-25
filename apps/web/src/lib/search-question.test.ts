// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  decodeSearchQuestion,
  encodeSearchQuestion,
  SearchQuestionSchema,
  simpleSearchQuestion,
  resolveSearchQuestion,
} from "@openlaw/shared";

describe("the question URL codec", () => {
  it("round trips Unicode and every question property in one base64url value", () => {
    const question = {
      ...simpleSearchQuestion("免責 café", ["contract", "document"]),
      words: { all: "免責 café", phrase: "change of control", any: "renew extend", none: "draft" },
      scope: { titles: false, text: true, contents: true },
      match: "any" as const,
      conditions: [
        {
          kind: "contract" as const,
          property: "title",
          operator: "contains",
          value: "Delaware",
        },
      ],
      sort: "expiry" as const,
    };
    const encoded = encodeSearchQuestion(question);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSearchQuestion(encoded)).toEqual(question);
  });
  it("refuses malformed, unknown-version, and invalid questions using the shared schema", () => {
    for (const value of [
      "!",
      "e30",
      "_w",
      btoa(JSON.stringify({ ...simpleSearchQuestion("words"), version: 2 })),
    ]) {
      expect(decodeSearchQuestion(value)).toBeNull();
    }
    expect(SearchQuestionSchema.safeParse(simpleSearchQuestion()).success).toBe(false);
    expect(() => encodeSearchQuestion(simpleSearchQuestion())).toThrow();
  });
});

it("reads past a removed property in a stored question and its URL without losing sort or other conditions", () => {
  const kept = {
    kind: "contract" as const,
    property: "expiry",
    operator: "in_next_days",
    value: 90,
  };
  const question = {
    ...simpleSearchQuestion("renewal", ["contract"]),
    sort: "expiry" as const,
    conditions: [
      kept,
      { kind: "contract" as const, property: "removed", operator: "contains", value: "x" },
    ],
  };
  expect(resolveSearchQuestion(question)).toEqual({
    question: { ...question, conditions: [kept] },
    dropped: 1,
  });
  const encoded = btoa(JSON.stringify(question))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  expect(decodeSearchQuestion(encoded)).toEqual({ ...question, conditions: [kept] });
  expect(SearchQuestionSchema.safeParse(question).success).toBe(false);
});
