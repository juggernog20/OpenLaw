// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractTypes, contractTypeFields, fields } from "@openlaw/db";
import { startHarness, type TestHarness } from "../testing/harness.js";
import { buildAnalysisTargets } from "./analysis-targets.js";
import { AI_PROMPTS, CORE_ANALYSIS_TARGETS } from "@openlaw/shared";

describe("the core contract analysis targets", () => {
  it("exports the seven core slugs with defaults and writer types", () => {
    expect(CORE_ANALYSIS_TARGETS.map(({ slug }) => slug)).toEqual([
      "term_type",
      "effective_date",
      "expiry_date",
      "renewal_period_months",
      "notice_period_days",
      "value",
      "counterparty",
    ]);
    expect(CORE_ANALYSIS_TARGETS.map(({ type }) => type)).toEqual([
      "term_type",
      "date",
      "date",
      "integer",
      "integer",
      "value",
      "counterparty",
    ]);
    expect(
      CORE_ANALYSIS_TARGETS.every(({ defaultPrompt }) => defaultPrompt.trim().length > 0),
    ).toBe(true);
  });
});

it("keeps all twelve defaults about meaning only", () => {
  expect(AI_PROMPTS.map(({ defaultPrompt }) => defaultPrompt)).toEqual([
    "Propose a concise opening {module} title.",
    "Synthesize a useful {module} Overview description from the supported facts. Cite all supporting passages. No legal risk assessment.",
    "Propose priority. Request urgency is the default.",
    "Extract the explicitly stated Needed by date. Do not guess missing date parts.",
    "Extract the explicitly named Counterparty legal name. Never invent a name.",
    "Extract the Contract term type.",
    "Extract the Contract's effective date.",
    "Extract the Contract's expiry or end date.",
    "Extract the length of each automatic renewal period.",
    "Extract the notice period for non-renewal or termination.",
    "Extract the Contract value.",
    "Extract the full legal name of the primary Counterparty.",
  ]);
});

describe("the Contract analysis target list", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("skips attached user and entity Fields with or without saved prompts", async () => {
    const [type] = await harness.db
      .insert(contractTypes)
      .values({
        slug: "reference_targets",
        displayName: "Reference targets",
        displayOrder: 0,
      })
      .returning();
    for (const fieldType of ["user", "entity", "text"] as const) {
      for (const aiPrompt of [null, "Extract the named party."]) {
        const [field] = await harness.db
          .insert(fields)
          .values({
            slug: `${fieldType}_${aiPrompt ? "prompted" : "unprompted"}`,
            displayName: `${fieldType} reference`,
            moduleScope: "contract",
            fieldType,
            fieldTag: "business",
            aiPrompt,
          })
          .returning();
        await harness.db
          .insert(contractTypeFields)
          .values({ typeId: type!.id, fieldId: field!.id, displayOrder: 0 });
      }
    }
    expect((await buildAnalysisTargets(harness.db, type!.id)).map(({ slug }) => slug)).toEqual([
      ...CORE_ANALYSIS_TARGETS.map(({ slug }) => slug),
      "text_prompted",
    ]);
  });
});
