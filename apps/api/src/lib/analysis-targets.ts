// SPDX-License-Identifier: AGPL-3.0-only

import {
  aiFieldPrompts,
  and,
  asc,
  contractTypeFields,
  eq,
  fields,
  isNotNull,
  isNull,
  type Executor,
  type FieldType,
} from "@openlaw/db";
import { CORE_ANALYSIS_TARGETS, type CoreAnalysisTargetType } from "@openlaw/shared";
import type { AiExtractionTarget } from "./ai/provider.js";

export interface AnalysisTarget extends AiExtractionTarget {
  type: CoreAnalysisTargetType | FieldType;
  options: string[] | null;
  core: boolean;
}

/** Builds the core vocabulary followed by prompted Fields in attachment order. */
export async function buildAnalysisTargets(
  db: Executor,
  contractTypeId: string,
): Promise<AnalysisTarget[]> {
  const [overrides, attached] = await Promise.all([
    db.select().from(aiFieldPrompts),
    db
      .select({
        slug: fields.slug,
        prompt: fields.aiPrompt,
        type: fields.fieldType,
        options: fields.options,
      })
      .from(contractTypeFields)
      .innerJoin(fields, eq(contractTypeFields.fieldId, fields.id))
      .where(
        and(
          eq(contractTypeFields.typeId, contractTypeId),
          eq(fields.moduleScope, "contract"),
          isNull(fields.archivedAt),
          isNotNull(fields.aiPrompt),
        ),
      )
      .orderBy(asc(contractTypeFields.displayOrder), asc(contractTypeFields.createdAt)),
  ]);
  const promptBySlug = new Map(overrides.map((row) => [row.slug, row.prompt]));
  return [
    ...CORE_ANALYSIS_TARGETS.map((target) => ({
      slug: target.slug,
      prompt: promptBySlug.get(target.slug) ?? target.defaultPrompt,
      type: target.type,
      options: null,
      core: true,
    })),
    ...attached.map((field) => ({
      slug: field.slug,
      prompt: field.prompt!,
      type: field.type,
      options: field.options ?? null,
      core: false,
    })),
  ];
}
