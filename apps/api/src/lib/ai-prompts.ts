// SPDX-License-Identifier: AGPL-3.0-only

/** Read editable prompts and the Organization answer style for each run. */

import { aiConnector, aiFieldPrompts, type Executor } from "@openlaw/db";
import { AI_PROMPTS, type AiAnswerStyle, type AiPromptSlug } from "@openlaw/shared";

export interface AiPromptBook {
  /** The effective text under one slug: the override, else the default. */
  prompt(slug: AiPromptSlug): string;
  readonly answerStyle: AiAnswerStyle;
}

const DEFAULTS = new Map(AI_PROMPTS.map((prompt) => [prompt.slug, prompt.defaultPrompt]));

export async function readAiPrompts(db: Executor): Promise<AiPromptBook> {
  const [rows, [connector]] = await Promise.all([
    db.select().from(aiFieldPrompts),
    db.select({ answerStyle: aiConnector.answerStyle }).from(aiConnector).limit(1),
  ]);
  const overrides = new Map(rows.map((row) => [row.slug, row.prompt]));
  const prompt = (slug: AiPromptSlug) => overrides.get(slug) ?? DEFAULTS.get(slug)!;
  return { prompt, answerStyle: connector?.answerStyle ?? "sentence" };
}

/** A Conversion draft prompt with `{module}` said as Matter or Contract. */
export function conversionPrompt(
  book: AiPromptBook,
  slug: AiPromptSlug,
  moduleLabel: "Matter" | "Contract",
): string {
  return book.prompt(slug).replaceAll("{module}", moduleLabel);
}
