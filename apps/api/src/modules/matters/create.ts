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
  matterKeyDates,
  matterTemplateKeyDates,
  matterTemplateTasks,
  matterTemplates,
  matterTypeFields,
  matterTypes,
  users,
  type CustomFieldValue,
  type Matter,
  type SeverityLevel,
  type Transaction,
} from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { civilToday, shiftDays } from "../../lib/contract-term.js";
import {
  MATTER_CREATOR_ROLE,
  MATTER_MANAGER_REFUSAL,
  MATTER_MANAGER_ROLES,
} from "../../lib/matter-access.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { httpError } from "../../lib/problem.js";
import { createMatterTask } from "../matter-tasks/create.js";

export interface CreateMatterInput {
  actorId: string;
  title: string;
  matterTypeId: string;
  managerId?: string | null;
  priority?: SeverityLevel;
  risk?: SeverityLevel | null;
  description?: string | null;
  customFields?: Readonly<Record<string, CustomFieldValue | null>>;
  templateId?: string;
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

  const template = input.templateId
    ? (
        await tx
          .select()
          .from(matterTemplates)
          .where(eq(matterTemplates.id, input.templateId))
          .limit(1)
          .for("update")
      )[0]
    : null;
  if (
    input.templateId &&
    (!template || template.archivedAt || template.matterTypeId !== matterType.id)
  ) {
    throw httpError(400, "The template must be live and belong to the selected matter type.");
  }
  const templateContent = template
    ? await Promise.all([
        tx
          .select()
          .from(matterTemplateTasks)
          .where(eq(matterTemplateTasks.matterTemplateId, template.id))
          .orderBy(asc(matterTemplateTasks.displayOrder), asc(matterTemplateTasks.id)),
        tx
          .select()
          .from(matterTemplateKeyDates)
          .where(eq(matterTemplateKeyDates.matterTemplateId, template.id))
          .orderBy(asc(matterTemplateKeyDates.displayOrder), asc(matterTemplateKeyDates.id)),
      ])
    : ([[], []] as const);

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
    if (!person || person.archivedAt || !MATTER_MANAGER_ROLES.has(person.role)) {
      throw httpError(400, MATTER_MANAGER_REFUSAL);
    }
    manager = {
      id: person.id,
      displayName: person.displayName,
      image: person.image,
      archivedAt: null,
    };
  }

  const attached = await selectAttachedFields(tx, matterTypeFields, matterType.id);
  const attachedSlugs = new Set(attached.map((field) => field.slug));
  const templateDefaults = Object.fromEntries(
    Object.entries(template?.defaultCustomFields ?? {}).filter(([slug]) => attachedSlugs.has(slug)),
  );
  const { values: seededCustomFields } = await applyCustomFields(
    tx,
    attached,
    {},
    templateDefaults,
  );
  const { values: customFields } = await applyCustomFields(
    tx,
    attached,
    seededCustomFields,
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
      priority: input.priority ?? template?.defaultPriority ?? "medium",
      risk: input.risk !== undefined ? input.risk : (template?.defaultRisk ?? null),
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
      ...(template ? { template: template.name } : {}),
    },
  });
  if (template) {
    const createdOn = civilToday(row!.createdAt);
    for (const task of templateContent[0]) {
      await createMatterTask(tx, {
        matter: row!,
        title: task.title,
        assigneeId: task.assigneeRole === "matter_manager" ? row!.managerId : null,
        dueDate: task.dueOffsetDays === null ? null : shiftDays(createdOn, task.dueOffsetDays),
        actorId: input.actorId,
      });
    }
    for (const keyDate of templateContent[1]) {
      const date = shiftDays(createdOn, keyDate.offsetDays);
      const [created] = await tx
        .insert(matterKeyDates)
        .values({
          matterId: row!.id,
          date,
          label: keyDate.label,
          note: keyDate.note,
        })
        .returning({ id: matterKeyDates.id });
      await recordActivity(tx, {
        entityType: "matter",
        entityId: row!.id,
        actorId: input.actorId,
        action: "key_date.added",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { keyDateId: created!.id, label: keyDate.label, date },
      });
    }
  }
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
