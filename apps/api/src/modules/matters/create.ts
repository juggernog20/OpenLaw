// SPDX-License-Identifier: AGPL-3.0-only

/** Matter creation as a caller-owned transactional step (M22/2). */
import {
  and,
  asc,
  eq,
  isNull,
  matters,
  matterStatuses,
  matterTeam,
  matterTypeFields,
  matterTypes,
  users,
  type CustomFieldValue,
  type Matter,
  type SeverityLevel,
  type Transaction,
} from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { MATTER_CREATOR_ROLE } from "../../lib/matter-access.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { httpError } from "../../lib/problem.js";

const MANAGER_ROLES = new Set<string>(["administrator", "legal_team_member"]);

export interface CreateMatterInput {
  actorId: string;
  title: string;
  matterTypeId: string;
  managerId?: string | null;
  priority?: SeverityLevel;
  risk?: SeverityLevel | null;
  description?: string | null;
  customFields?: Readonly<Record<string, CustomFieldValue | null>>;
  isConfidential?: boolean;
}

export interface CreatedMatter {
  row: Matter;
  matterTypeName: string;
  statusName: string;
  statusCategory: "open" | "closed";
  manager: {
    id: string;
    displayName: string;
    image: string | null;
    archivedAt: Date | null;
  } | null;
}

export async function createMatter(
  tx: Transaction,
  input: CreateMatterInput,
): Promise<CreatedMatter> {
  const [matterType] = await tx
    .select({
      id: matterTypes.id,
      displayName: matterTypes.displayName,
      archivedAt: matterTypes.archivedAt,
    })
    .from(matterTypes)
    .where(eq(matterTypes.id, input.matterTypeId))
    .limit(1)
    .for("update");
  if (!matterType || matterType.archivedAt) {
    throw httpError(400, "The matter type must be a live matter type.");
  }

  const [status] = await tx
    .select({
      id: matterStatuses.id,
      displayName: matterStatuses.displayName,
      category: matterStatuses.category,
    })
    .from(matterStatuses)
    .where(and(eq(matterStatuses.category, "open"), isNull(matterStatuses.archivedAt)))
    .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.createdAt))
    .limit(1);
  if (!status) throw httpError(500, "The default open matter status is missing.");

  let manager: CreatedMatter["manager"] = null;
  if (input.managerId) {
    const [person] = await tx
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        role: users.role,
        archivedAt: users.archivedAt,
      })
      .from(users)
      .where(eq(users.id, input.managerId))
      .limit(1)
      .for("update");
    if (!person || person.archivedAt || !MANAGER_ROLES.has(person.role)) {
      throw httpError(400, "The Matter Manager must be a live Legal Team Member or Administrator.");
    }
    manager = {
      id: person.id,
      displayName: person.displayName,
      image: person.image,
      archivedAt: null,
    };
  }

  const attached = await selectAttachedFields(tx, matterTypeFields, matterType.id);
  const { values: customFields } = await applyCustomFields(
    tx,
    attached,
    {},
    input.customFields ?? {},
  );
  assertRequiredCustomFields(attached, customFields);

  const confidential = input.isConfidential ?? false;
  const [row] = await tx
    .insert(matters)
    .values({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      matterTypeId: matterType.id,
      statusId: status.id,
      managerId: manager?.id ?? null,
      priority: input.priority ?? "medium",
      risk: input.risk ?? null,
      customFields,
      isConfidential: confidential,
      createdBy: input.actorId,
    })
    .returning();
  await tx
    .insert(matterTeam)
    .values({ matterId: row!.id, userId: input.actorId, role: MATTER_CREATOR_ROLE });
  await recordActivity(tx, {
    entityType: "matter",
    entityId: row!.id,
    actorId: input.actorId,
    action: "matter.created",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      number: row!.number,
      title: row!.title,
      matterType: matterType.displayName,
      status: status.displayName,
      customFields: Object.keys(customFields).sort((a, b) => a.localeCompare(b)),
    },
  });
  if (confidential) {
    await recordActivity(tx, {
      entityType: "matter",
      entityId: row!.id,
      actorId: input.actorId,
      action: "matter.confidentiality_set",
      visibility: RECORD_ACTIVITY_TIER,
      payload: { number: row!.number, title: row!.title },
    });
  }
  return {
    row: row!,
    matterTypeName: matterType.displayName,
    statusName: status.displayName,
    statusCategory: status.category,
    manager,
  };
}
