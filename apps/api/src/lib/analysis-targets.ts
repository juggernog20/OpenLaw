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
  formRowTouchpoint,
  isReferenceFieldType,
  type CoreAnalysisTargetType,
} from "@openlaw/shared";
import type { AiExtractionTarget } from "./ai/provider.js";
import { readTypeForm } from "./type-form-routes.js";
import { intakeRows } from "./intake-form.js";
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
  recordOnly = false,
): Promise<AnalysisTarget[]> {
  const [book, attached] = await Promise.all([
    readAiPrompts(db),
    db
      .select({
        slug: fields.slug,
        prompt: fields.aiPrompt,
        aiAnswerStyle: fields.aiAnswerStyle,
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
          recordOnly ? undefined : isNotNull(fields.aiPrompt),
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
  const rows = recordOnly
    ? intakeRows(await readTypeForm(db, "contract", contractTypeId)).filter(
        (row) => formRowTouchpoint(row) === "record",
      )
    : null;
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
      prompt: field.prompt || `Extract ${field.slug}.`,
      aiAnswerStyle: field.aiAnswerStyle,
      type: field.type,
      options: field.options ?? null,
      core: false,
    })),
  ].filter(
    (target) =>
      !rows ||
      rows.some(
        (row) => row.rowRef === (target.slug === "counterparty" ? "counterparties" : target.slug),
      ),
  );
}
