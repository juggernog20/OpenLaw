// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The effective prompts for one AI run (CTR-008, 2026-09-19 addendum).
 *
 * `ai_field_prompts` stores an override per slug and nothing else, so
 * the default lives with the canonical list in `@openlaw/shared` and
 * absence means the default. One read answers every slug for one run:
 * the shared rule paragraphs the extraction prompt carries, the
 * Conversion draft's built-in targets, and the seven core analysis
 * targets. Nothing is cached, so the next run reads a saved prompt with
 * no restart.
 */

import { aiFieldPrompts, type Executor } from "@openlaw/db";
import { AI_PROMPTS, AI_RULE_PROMPTS, type AiPromptSlug } from "@openlaw/shared";

export interface AiPromptBook {
  /** The effective text under one slug: the override, else the default. */
  prompt(slug: AiPromptSlug): string;
  /** The shared rule paragraphs, in the order the prompt carries them. */
  readonly rules: readonly string[];
}

const DEFAULTS = new Map(AI_PROMPTS.map((prompt) => [prompt.slug, prompt.defaultPrompt]));

export async function readAiPrompts(db: Executor): Promise<AiPromptBook> {
  const rows = await db.select().from(aiFieldPrompts);
  const overrides = new Map(rows.map((row) => [row.slug, row.prompt]));
  const prompt = (slug: AiPromptSlug) => overrides.get(slug) ?? DEFAULTS.get(slug)!;
  return { prompt, rules: AI_RULE_PROMPTS.map((rule) => prompt(rule.slug)) };
}

/** A Conversion draft prompt with `{module}` said as Matter or Contract. */
export function conversionPrompt(
  book: AiPromptBook,
  slug: AiPromptSlug,
  moduleLabel: "Matter" | "Contract",
): string {
  return book.prompt(slug).replaceAll("{module}", moduleLabel);
}
