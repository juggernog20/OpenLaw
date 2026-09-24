// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

export const SEARCH_KINDS = [
  "contract",
  "matter",
  "document",
  "entity",
  "counterparty",
  "request",
  "knowledge_item",
] as const;
export const DEFAULT_SEARCH_SCOPE = { titles: true, text: true, contents: true } as const;
const WordsRowSchema = z
  .string()
  .trim()
  .max(200, "Search words rows must be 200 characters or fewer.");

export const SearchQuestionSchema = z
  .object({
    version: z.literal(1),
    words: z.object({
      all: WordsRowSchema,
      phrase: WordsRowSchema,
      any: WordsRowSchema,
      none: WordsRowSchema,
    }),
    scope: z.object({ titles: z.boolean(), text: z.boolean(), contents: z.boolean() }),
    kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length),
    conditions: z
      .array(
        z.object({
          kind: z.enum(SEARCH_KINDS),
          property: z.string().min(1).max(200),
          operator: z.string().min(1).max(100),
          value: z
            .unknown()
            .refine((value) => value !== undefined, "A condition value is required."),
        }),
      )
      .max(20),
    match: z.enum(["all", "any"]),
    sort: z.enum(["relevance", "newest", "oldest", "expiry", "title"]),
  })
  .superRefine((question, ctx) => {
    const hasWords = Object.values(question.words).some(Boolean);
    if (hasWords && !Object.values(question.scope).some(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Choose at least one search scope.",
      });
    }
    if (!hasWords && question.conditions.length === 0 && question.kinds.length === 0) {
      ctx.addIssue({ code: "custom", message: "Enter words, choose a kind, or add a condition." });
    }
    question.conditions.forEach((condition, index) => {
      if (!question.kinds.includes(condition.kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["conditions", index, "kind"],
          message: "Choose the condition's kind.",
        });
      }
    });
  });

export type SearchQuestion = z.infer<typeof SearchQuestionSchema>;

/** Also used for the blank page after the last chip is removed. */
export function simpleSearchQuestion(
  all = "",
  kinds: SearchQuestion["kinds"] = [],
): SearchQuestion {
  return {
    version: 1,
    words: { all, phrase: "", any: "", none: "" },
    scope: { ...DEFAULT_SEARCH_SCOPE },
    kinds,
    conditions: [],
    match: "all",
    sort: "relevance",
  };
}

export function encodeSearchQuestion(question: SearchQuestion): string {
  const bytes = new TextEncoder().encode(JSON.stringify(SearchQuestionSchema.parse(question)));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeSearchQuestion(encoded: string): SearchQuestion | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
      char.charCodeAt(0),
    );
    const parsed = SearchQuestionSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
