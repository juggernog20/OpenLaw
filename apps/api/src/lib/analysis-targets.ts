// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-008's composed extraction vocabulary: shared core targets followed by
 * prompted Fields attached to the Contract's type, with editable prompt
 * overrides applied to the core entries.
 */

import {
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
import {
  CORE_ANALYSIS_TARGETS,
  isReferenceFieldType,
  type CoreAnalysisTargetType,
} from "@openlaw/shared";
import type { AiExtractionTarget } from "./ai/provider.js";
import { readAiPrompts } from "./ai-prompts.js";

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
  const [book, attached] = await Promise.all([
    readAiPrompts(db),
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
  // New Fields cannot take a core slug (the catalog reserves them), but a
  // Field created before M31 may already hold one. The core target owns
  // the slug in the outcome and the unverified map, so such a Field is
  // left out rather than written twice under one key. A user or Entity
  // Field is skipped even when it still carries a prompt saved before #959.
  const coreSlugs = new Set<string>(CORE_ANALYSIS_TARGETS.map((target) => target.slug));
  const catalog = attached.filter(
    (field) => !isReferenceFieldType(field.type) && !coreSlugs.has(field.slug),
  );
  return [
    ...CORE_ANALYSIS_TARGETS.map((target) => ({
      slug: target.slug,
      prompt: book.prompt(target.slug),
      type: target.type,
      options: null,
      core: true,
    })),
    ...catalog.map((field) => ({
      slug: field.slug,
      prompt: field.prompt!,
      type: field.type,
      options: field.options ?? null,
      core: false,
    })),
  ];
}
