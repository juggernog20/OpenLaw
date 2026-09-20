// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Administrator-only prompt overrides (CTR-008, M31/5; widened on
 * 2026-09-19). One route serves the whole editable catalog in
 * `@openlaw/shared`: the Conversion draft's built-in targets and the seven core
 * analysis targets. The table stores an override per slug and nothing
 * else, so a reset is a delete and absence is the default.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { aiFieldPrompts, eq, inArray } from "@openlaw/db";
import { AI_PROMPT_GROUPS, AI_PROMPT_SLUGS, AI_PROMPTS, type AiPromptSlug } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { problemResponse } from "../../lib/problem.js";

const SlugSchema = z.enum(AI_PROMPT_SLUGS);
const AiPromptSchema = z.string().trim().max(2_000);
type AiFieldPrompt = typeof aiFieldPrompts.$inferSelect;
type AiPrompt = (typeof AI_PROMPTS)[number];

const PromptSchema = z.object({
  slug: SlugSchema,
  group: z.enum(AI_PROMPT_GROUPS),
  prompt: z.string(),
  defaultPrompt: z.string(),
  overridden: z.boolean(),
});
const PromptEnvelope = z.object({ prompt: PromptSchema });
const PromptListEnvelope = z.object({ prompts: z.array(PromptSchema) });

function targetFor(slug: AiPromptSlug): AiPrompt {
  return AI_PROMPTS.find((target) => target.slug === slug)!;
}

function effectivePrompt(target: AiPrompt, override?: AiFieldPrompt) {
  return {
    slug: target.slug as AiPromptSlug,
    group: target.group,
    prompt: override?.prompt ?? target.defaultPrompt,
    defaultPrompt: target.defaultPrompt,
    overridden: override !== undefined,
  };
}

export const aiFieldPromptRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/ai-field-prompts",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listAiFieldPrompts",
        summary:
          "Read the effective and default text of every editable prompt: the Conversion draft's built-in targets, and the seven core analysis targets",
        tags: ["ai-field-prompts"],
        response: { 200: PromptListEnvelope, default: problemResponse },
      },
    },
    async () => {
      const rows = await app.db
        .select()
        .from(aiFieldPrompts)
        .where(inArray(aiFieldPrompts.slug, [...AI_PROMPT_SLUGS]));
      const bySlug = new Map(rows.map((row) => [row.slug, row]));
      return {
        prompts: AI_PROMPTS.map((target) => effectivePrompt(target, bySlug.get(target.slug))),
      };
    },
  );

  app.put(
    "/ai-field-prompts",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "saveAiFieldPrompt",
        summary: "Save or reset one prompt by slug; null or blank resets it to the default",
        tags: ["ai-field-prompts"],
        body: z.object({ slug: SlugSchema, prompt: AiPromptSchema.nullable() }),
        response: { 200: PromptEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const target = targetFor(request.body.slug);
      const value = request.body.prompt?.trim() || null;
      const row = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(aiFieldPrompts)
          .where(eq(aiFieldPrompts.slug, target.slug))
          .limit(1)
          .for("update");

        if (value === null) {
          if (!current) return undefined;
          await tx.delete(aiFieldPrompts).where(eq(aiFieldPrompts.slug, target.slug));
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "ai_field_prompt.reset",
            visibility: "admin_only",
            payload: { slug: target.slug },
          });
          return undefined;
        }

        if (current?.prompt === value) return current;
        const [saved] = await tx
          .insert(aiFieldPrompts)
          .values({ slug: target.slug, prompt: value })
          .onConflictDoUpdate({
            target: aiFieldPrompts.slug,
            set: { prompt: value, updatedAt: new Date() },
          })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "ai_field_prompt.updated",
          visibility: "admin_only",
          payload: { slug: target.slug },
        });
        return saved;
      });

      return { prompt: effectivePrompt(target, row) };
    },
  );
};
