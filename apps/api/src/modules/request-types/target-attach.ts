// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The companion attach on a request type's default destination type
 * (INT-002, 2026-09-19 addendum).
 *
 * The scope rule in `form-definition.ts` says which catalog fields a
 * form may collect. It reads the target's module, never the target
 * type, so a contract-scoped field passes it and can still have no
 * Field to land in at conversion: the carry-through rule (INT-007)
 * lands a collected value only where the target type attaches the same
 * slug. Nothing joined the two rules, and the value stayed on the
 * Request while the dialog called it "Does not carry".
 *
 * This is the join. When the attach body says `alsoAttachToTarget`, the
 * same field is appended to the request type's default contract or
 * matter type in the same transaction, through the same append-order
 * and duplicate reads the target's own editor uses, with the target
 * mount's own DD-017 entry. It is asked for, never implied: the editor
 * offers it, the Administrator chooses, and the request arrives with
 * the flag. A target that already attaches the field is the outcome
 * wanted, so it answers `attached: false` rather than refusing.
 *
 * Refused, by name: a request type with no default destination type
 * (there is nothing to attach to), a default field (it is already part
 * of every record and carries on its own), and an archived target type
 * (archived means hidden everywhere, so the editor could not show what
 * was attached).
 */

import {
  contractTypeFields,
  contractTypes,
  eq,
  matterTypeFields,
  matterTypes,
  type Field,
  type RequestType,
  type Transaction,
} from "@openlaw/db";
import { recordActivity } from "../../lib/activity.js";
import { httpError } from "../../lib/problem.js";
import {
  appendedOrder,
  type TargetAttachment,
  type TypeFieldTargetAttachRule,
} from "../../lib/type-field-routes.js";

async function lockedTarget(tx: Transaction, type: RequestType) {
  const module: "contract" | "matter" | null =
    type.targetModule === "contract" || type.targetModule === "matter" ? type.targetModule : null;
  const typeId = module === "contract" ? type.targetContractTypeId : type.targetMatterTypeId;
  if (!module || !typeId) {
    throw httpError(
      400,
      "This request type has no default destination type, so there is no type to attach the field to.",
    );
  }
  const typesTable = module === "contract" ? contractTypes : matterTypes;
  const joinTable = module === "contract" ? contractTypeFields : matterTypeFields;
  const [target] = await tx
    .select()
    .from(typesTable)
    .where(eq(typesTable.id, typeId))
    .limit(1)
    .for("update");
  if (!target) {
    throw httpError(404, `The default ${module} type no longer exists.`);
  }
  if (target.archivedAt) {
    throw httpError(409, `${target.displayName} is archived. Restore it first.`);
  }

  return { module, target, joinTable };
}

async function attachToTarget(
  tx: Transaction,
  type: RequestType,
  field: Field,
  actorId: string,
): Promise<TargetAttachment> {
  const { module, target, joinTable } = await lockedTarget(tx, type);
  if (field.builtInKey) {
    throw httpError(
      400,
      `${field.displayName} is a default field. It is already part of every record and carries on its own.`,
    );
  }
  if (field.moduleScope !== module) {
    throw httpError(
      400,
      `${field.displayName} is ${field.moduleScope}-scoped and cannot be attached to a ${module} type.`,
    );
  }

  const answer: Omit<TargetAttachment, "attached"> = {
    module,
    typeId: target.id,
    typeDisplayName: target.displayName,
  };
  const displayOrder = await appendedOrder(tx, joinTable, target.id, field.id);
  if (displayOrder === null) return { ...answer, attached: false };

  await tx.insert(joinTable).values({
    typeId: target.id,
    fieldId: field.id,
    displayOrder,
    isRequired: false,
    visibleOnPortal: field.fieldTag === "business",
  });
  await recordActivity(tx, {
    entityType: "system",
    actorId,
    action: `${module}_type_field.attached`,
    visibility: "admin_only",
    // The target mount's own entry, in its own shape: the log reads
    // "attached to NDA", the same as if its editor had done it.
    payload: { typeSlug: target.slug, fieldSlug: field.slug, isRequired: false },
  });
  return { ...answer, attached: true };
}

export const requestTypeTargetAttach: TypeFieldTargetAttachRule<RequestType> = {
  summary: "the request type's default destination type (INT-002)",
  async lock(tx, type, expected) {
    await lockedTarget(tx, type);
    const typeId =
      type.targetModule === "contract" ? type.targetContractTypeId : type.targetMatterTypeId;
    if (type.targetModule !== expected.module || typeId !== expected.typeId) {
      throw httpError(
        409,
        "The default destination changed. Check the destination and attach the field again.",
      );
    }
  },
  run: attachToTarget,
};
