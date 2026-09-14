// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-008 and ADO-009: current Portal audience and acknowledgements at each read and accepted use. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES,
  and,
  asc,
  autoDocAcknowledgements,
  autoDocAudienceDepartments,
  autoDocAudienceUsers,
  autoDocFormVersions,
  autoDocs,
  contractTypes,
  departments,
  desc,
  entities,
  eq,
  inArray,
  isNull,
  or,
  orgSettings,
  sql,
  users,
  type AutoDoc,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import type { ChangedFields } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError } from "../../lib/problem.js";
import { portalEntityScope } from "../../lib/portal-entities.js";
import { assignmentGaps, readAssignmentRules } from "./assignment.js";
import { latestForm } from "./forms.js";

export const AcknowledgementText = z.string().trim().min(1).max(10_000);
const DistinctIds = z
  .array(z.string().min(1))
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each person or Department once.");
export const PortalSettingsShape = {
  audienceUserIds: DistinctIds.optional(),
  audienceDepartmentIds: DistinctIds.optional(),
  acknowledgementText: AcknowledgementText.nullable().optional(),
  acknowledgementFrequency: z.enum(AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES).optional(),
};
export const textHash = (text: string) => createHash("sha256").update(text).digest("hex");
export function portalAutoDocScope(user: AuthenticatedUser) {
  if (user.role !== "business_user") return sql`true`;
  return sql`(${autoDocs.audience} = 'everyone' or (${autoDocs.audience} = 'selected' and (
    exists (select 1 from ${autoDocAudienceUsers} where ${autoDocAudienceUsers.autoDocId} = ${autoDocs.id} and ${autoDocAudienceUsers.userId} = ${user.id})
    or exists (select 1 from ${autoDocAudienceDepartments}
      join ${departments} on ${departments.id} = ${autoDocAudienceDepartments.departmentId} and ${departments.archivedAt} is null
      join ${users} on ${users.departmentId} = ${departments.id} and ${users.id} = ${user.id} and ${users.archivedAt} is null
      where ${autoDocAudienceDepartments.autoDocId} = ${autoDocs.id})
  )))`;
}
export async function readPortalAutoDoc(
  db: Executor,
  user: AuthenticatedUser,
  id: string,
  published: boolean,
  lock = false,
) {
  const query = db
    .select()
    .from(autoDocs)
    .where(and(eq(autoDocs.id, id), portalAutoDocScope(user)));
  const [row] = lock ? await query.for("share") : await query;
  if (!row) throw httpError(404, "This Auto-Doc is not available to you.");
  if (published && row.state !== "published")
    throw httpError(
      409,
      `"${row.name}" is no longer published. Your answers have not been submitted.`,
    );
  return row;
}
export async function lockPortalPerson(tx: Transaction, user: AuthenticatedUser) {
  const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for("share");
  if (!current || current.archivedAt || current.role !== user.role)
    throw httpError(403, "Your access has changed. Reload this page before continuing.");
  if (current.departmentId)
    await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, current.departmentId))
      .for("share");
}
export async function acknowledgementWords(db: Executor, autoDoc: AutoDoc, lock = false) {
  const query = db.select({ text: orgSettings.autoDocAcknowledgementText }).from(orgSettings);
  const [org] = lock ? await query.for("share") : await query;
  if (!org) throw httpError(500, "The organisation settings could not be read.");
  const text = autoDoc.acknowledgementText ?? org.text;
  return { text, textHash: textHash(text), defaultText: org.text };
}
export async function revokeAcknowledgements(tx: Transaction, hash: string, autoDocId?: string) {
  await tx
    .update(autoDocAcknowledgements)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(autoDocAcknowledgements.textHash, hash),
        isNull(autoDocAcknowledgements.revokedAt),
        autoDocId
          ? or(
              eq(autoDocAcknowledgements.autoDocId, autoDocId),
              isNull(autoDocAcknowledgements.autoDocId),
            )
          : undefined,
      ),
    );
}
export async function readAudience(db: Executor, id: string) {
  const [people, teams] = await Promise.all([
    db
      .select({ id: autoDocAudienceUsers.userId })
      .from(autoDocAudienceUsers)
      .where(eq(autoDocAudienceUsers.autoDocId, id))
      .orderBy(asc(autoDocAudienceUsers.userId)),
    db
      .select({ id: autoDocAudienceDepartments.departmentId })
      .from(autoDocAudienceDepartments)
      .where(eq(autoDocAudienceDepartments.autoDocId, id))
      .orderBy(asc(autoDocAudienceDepartments.departmentId)),
  ]);
  return {
    audienceUserIds: people.map((person) => person.id),
    audienceDepartmentIds: teams.map((department) => department.id),
  };
}
export async function applyPortalSettings(
  tx: Transaction,
  row: AutoDoc,
  body: z.infer<z.ZodObject<typeof PortalSettingsShape>>,
  patch: Partial<AutoDoc>,
  changed: ChangedFields,
) {
  if (
    body.acknowledgementText !== undefined &&
    body.acknowledgementText !== row.acknowledgementText
  ) {
    const before = await acknowledgementWords(tx, row, true);
    const next = body.acknowledgementText ?? before.defaultText;
    if (next !== before.text) await revokeAcknowledgements(tx, before.textHash, row.id);
    patch.acknowledgementText = body.acknowledgementText;
    changed.acknowledgementText = { from: row.acknowledgementText, to: body.acknowledgementText };
  }
  if (
    body.acknowledgementFrequency !== undefined &&
    body.acknowledgementFrequency !== row.acknowledgementFrequency
  ) {
    patch.acknowledgementFrequency = body.acknowledgementFrequency;
    changed.acknowledgementFrequency = {
      from: row.acknowledgementFrequency,
      to: body.acknowledgementFrequency,
    };
  }
  const before = await readAudience(tx, row.id);
  if (body.audienceUserIds) {
    const ids = [...body.audienceUserIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(before.audienceUserIds)) {
      const chosen = ids.length
        ? await tx
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(and(inArray(users.id, ids), isNull(users.archivedAt)))
            .orderBy(asc(users.id))
            .for("share")
        : [];
      if (chosen.length !== ids.length)
        throw httpError(400, "Choose live people for the Auto-Doc audience.");
      const old = before.audienceUserIds.length
        ? await tx
            .select({ name: users.displayName })
            .from(users)
            .where(inArray(users.id, before.audienceUserIds))
            .orderBy(asc(users.id))
        : [];
      changed.audienceUsers = {
        from: old.map((person) => person.name).join(", ") || null,
        to: chosen.map((person) => person.name).join(", ") || null,
      };
      await tx.delete(autoDocAudienceUsers).where(eq(autoDocAudienceUsers.autoDocId, row.id));
      if (ids.length)
        await tx
          .insert(autoDocAudienceUsers)
          .values(ids.map((userId) => ({ autoDocId: row.id, userId })));
    }
  }
  if (body.audienceDepartmentIds) {
    const ids = [...body.audienceDepartmentIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(before.audienceDepartmentIds)) {
      const chosen = ids.length
        ? await tx
            .select({ id: departments.id, name: departments.displayName })
            .from(departments)
            .where(and(inArray(departments.id, ids), isNull(departments.archivedAt)))
            .orderBy(asc(departments.id))
            .for("share")
        : [];
      if (chosen.length !== ids.length)
        throw httpError(400, "Choose live Departments for the Auto-Doc audience.");
      const old = before.audienceDepartmentIds.length
        ? await tx
            .select({ name: departments.displayName })
            .from(departments)
            .where(inArray(departments.id, before.audienceDepartmentIds))
            .orderBy(asc(departments.id))
        : [];
      changed.audienceDepartments = {
        from: old.map((department) => department.name).join(", ") || null,
        to: chosen.map((department) => department.name).join(", ") || null,
      };
      await tx
        .delete(autoDocAudienceDepartments)
        .where(eq(autoDocAudienceDepartments.autoDocId, row.id));
      if (ids.length)
        await tx
          .insert(autoDocAudienceDepartments)
          .values(ids.map((departmentId) => ({ autoDocId: row.id, departmentId })));
    }
  }
}
export async function portalWarnings(db: Executor, autoDoc: AutoDoc) {
  if (autoDoc.audience === "legal_only") return [];
  const [published] = autoDoc.publishedFormVersionId
    ? await db
        .select()
        .from(autoDocFormVersions)
        .where(eq(autoDocFormVersions.id, autoDoc.publishedFormVersionId))
    : [];
  const form = published ?? (await latestForm(db, autoDoc.id));
  const warnings =
    form && autoDoc.targetContractTypeId
      ? assignmentGaps(form.definition, await readAssignmentRules(db, autoDoc.id))
      : [];
  if (warnings.length)
    warnings.push(
      "Publish a Form that matches the saved Assignment rules before Business Users generate this Auto-Doc.",
    );
  if (autoDoc.targetContractTypeId) {
    const [type] = await db
      .select({ id: contractTypes.id })
      .from(contractTypes)
      .where(
        and(eq(contractTypes.id, autoDoc.targetContractTypeId), isNull(contractTypes.archivedAt)),
      );
    if (!type)
      warnings.push(
        "Choose a live target Contract Type before Business Users generate this Auto-Doc.",
      );
    if (autoDoc.fixedEntityId) {
      const [entity] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.id, autoDoc.fixedEntityId), portalEntityScope));
      if (!entity)
        warnings.push(
          "The fixed Entity must be live, Portal-listed and non-Confidential. An Administrator can change its Portal-listed setting, or you can choose another Entity.",
        );
    }
  }
  return warnings;
}
export const PORTAL_UNAVAILABLE =
  "Legal needs to update this Auto-Doc before you can generate it. Please contact Legal.";
async function standingAcknowledgement(
  db: Executor,
  user: AuthenticatedUser,
  row: AutoDoc,
  hash: string,
  id?: string,
  lock = false,
) {
  const frequency = row.acknowledgementFrequency;
  if (frequency === "none" || (frequency === "every_use" && !id)) return null;
  const query = db
    .select()
    .from(autoDocAcknowledgements)
    .where(
      and(
        eq(autoDocAcknowledgements.userId, user.id),
        eq(autoDocAcknowledgements.textHash, hash),
        eq(autoDocAcknowledgements.frequency, frequency),
        isNull(autoDocAcknowledgements.revokedAt),
        frequency === "once"
          ? isNull(autoDocAcknowledgements.autoDocId)
          : eq(autoDocAcknowledgements.autoDocId, row.id),
        frequency === "every_use"
          ? and(eq(autoDocAcknowledgements.id, id!), isNull(autoDocAcknowledgements.consumedAt))
          : undefined,
      ),
    )
    .orderBy(desc(autoDocAcknowledgements.acknowledgedAt), desc(autoDocAcknowledgements.id))
    .limit(1);
  const [standing] = lock ? await query.for("update") : await query;
  return standing ?? null;
}
export async function acknowledgementState(
  db: Executor,
  user: AuthenticatedUser,
  row: AutoDoc,
  id?: string,
  lock = false,
) {
  const words = await acknowledgementWords(db, row, lock);
  const required =
    user.role === "business_user" &&
    row.acknowledgementFrequency !== "none" &&
    !(await standingAcknowledgement(db, user, row, words.textHash, id));
  return {
    frequency: row.acknowledgementFrequency,
    required,
    text: words.text,
    textHash: words.textHash,
  };
}
export async function acceptAcknowledgement(
  tx: Transaction,
  user: AuthenticatedUser,
  row: AutoDoc,
  shownHash: string,
) {
  if (user.role !== "business_user" || row.acknowledgementFrequency === "none") return null;
  const words = await acknowledgementWords(tx, row, true);
  if (shownHash !== words.textHash)
    throw httpError(
      409,
      "The acknowledgement has changed. Read the current text before continuing.",
    );
  const [ack] = await tx
    .insert(autoDocAcknowledgements)
    .values({
      userId: user.id,
      autoDocId: row.acknowledgementFrequency === "once" ? null : row.id,
      frequency: row.acknowledgementFrequency,
      textHash: words.textHash,
    })
    .returning();
  await recordActivity(tx, {
    entityType: "auto_doc",
    entityId: row.id,
    actorId: user.id,
    action: "auto_doc.acknowledged",
    visibility: "admin_only",
    payload: {
      name: row.name,
      text: words.text,
      textHash: words.textHash,
      frequency: row.acknowledgementFrequency,
      acknowledgementId: ack!.id,
    },
  });
  return ack!.id;
}
export async function authorisePortalGeneration(
  tx: Transaction,
  user: AuthenticatedUser,
  id: string,
  acknowledgementId?: string,
) {
  await lockPortalPerson(tx, user);
  const row = await readPortalAutoDoc(tx, user, id, true, true);
  if (user.role === "business_user" && (await portalWarnings(tx, row)).length)
    throw httpError(409, PORTAL_UNAVAILABLE);
  if (user.role !== "business_user" || row.acknowledgementFrequency === "none") return;
  const words = await acknowledgementWords(tx, row, true);
  const ack = await standingAcknowledgement(tx, user, row, words.textHash, acknowledgementId, true);
  if (!ack)
    throw httpError(
      409,
      "Acknowledge the current text before generating. Your answers have not been submitted.",
    );
  if (row.acknowledgementFrequency === "every_use")
    await tx
      .update(autoDocAcknowledgements)
      .set({ consumedAt: new Date() })
      .where(eq(autoDocAcknowledgements.id, ack.id));
}
