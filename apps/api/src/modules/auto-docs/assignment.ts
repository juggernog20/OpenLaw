// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-006: validate and resolve ordered Assignment rules from Auto-Doc settings (SCHEMA.md). */
import {
  and,
  asc,
  autoDocAssignmentRules,
  eq,
  inArray,
  isNull,
  users,
  type AutoDocCondition,
  type AutoDocFormDefinition,
  type CustomFieldValue,
  type Executor,
} from "@openlaw/db";
import { z } from "zod";
import { evaluateCondition } from "../../lib/auto-doc-fill/values.js";
import { httpError } from "../../lib/problem.js";
import { ConditionInput, conditionGaps } from "./forms.js";

export const AssignmentRuleInput = ConditionInput.safeExtend({
  id: z.string().min(1).optional(),
  legalOwnerId: z.string().min(1),
});
export const AssignmentRuleRow = AssignmentRuleInput.safeExtend({
  id: z.string(),
  displayOrder: z.number().int(),
}).strip();
export const AssignmentSettingsInput = z.strictObject({
  rules: z.array(AssignmentRuleInput).max(100),
  defaultLegalOwnerId: z.string().min(1).nullable(),
});

export function readAssignmentRules(db: Executor, autoDocId: string) {
  return db
    .select()
    .from(autoDocAssignmentRules)
    .where(eq(autoDocAssignmentRules.autoDocId, autoDocId))
    .orderBy(asc(autoDocAssignmentRules.displayOrder), asc(autoDocAssignmentRules.id));
}
export function assignmentGaps(definition: AutoDocFormDefinition, rules: AutoDocCondition[]) {
  return rules.flatMap((rule, index) =>
    conditionGaps(definition, rule, `Assignment rule ${index + 1}`),
  );
}
export function legalOwnerChoices(db: Executor) {
  return db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(
      and(isNull(users.archivedAt), inArray(users.role, ["administrator", "legal_team_member"])),
    )
    .orderBy(asc(users.displayName), asc(users.id));
}
async function readLegalOwner(db: Executor, id: string) {
  const [owner] = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.id, id),
        isNull(users.archivedAt),
        inArray(users.role, ["administrator", "legal_team_member"]),
      ),
    )
    .for("share");
  return owner ?? null;
}
export async function requireLegalOwner(db: Executor, id: string) {
  const owner = await readLegalOwner(db, id);
  if (!owner) throw httpError(400, "Choose a live Member or Administrator as Legal Owner.");
  return owner;
}
export async function chooseLegalOwner(
  db: Executor,
  autoDoc: { id: string; defaultLegalOwnerId: string | null },
  definition: AutoDocFormDefinition,
  answers: Record<string, CustomFieldValue>,
) {
  const rules = await readAssignmentRules(db, autoDoc.id);
  const gaps = assignmentGaps(definition, rules);
  if (gaps.length) throw httpError(409, gaps.join(" "));
  const id =
    rules.find((rule) => evaluateCondition(rule, answers))?.legalOwnerId ??
    autoDoc.defaultLegalOwnerId;
  return id ? ((await readLegalOwner(db, id))?.id ?? null) : null;
}
