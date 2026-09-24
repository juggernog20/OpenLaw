// SPDX-License-Identifier: AGPL-3.0-only
import {
  activityLog,
  and,
  asc,
  contracts,
  eq,
  isNull,
  matters,
  requests,
  requestTypes,
  users,
  type Db,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { NO_PERMISSION } from "../../auth/guards.js";
import { readIntakeForm } from "../../lib/intake-form.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError } from "../../lib/problem.js";
import { departmentName } from "../departments/references.js";
import {
  NO_REQUEST,
  requestAssignees,
  resolveRefs,
  resolveStaffRefs,
  selectAttachments,
  staffRequestRow,
  toStaffRequest,
} from "./projection.js";
import { toPortalRequestRow } from "./service.js";

export async function readMyRequest(db: Db, user: AuthenticatedUser, number: number) {
  const [row] = await db
    .select({
      id: requests.id,
      number: requests.number,
      status: requests.status,
      convertedContractId: requests.convertedContractId,
      convertedMatterId: requests.convertedMatterId,
      title: requests.title,
      description: requests.description,
      departmentId: requests.departmentId,
      urgency: requests.urgency,
      customFields: requests.customFields,
      declinedReason: requests.declinedReason,
      createdAt: requests.createdAt,
      typeId: requestTypes.id,
      typeSlug: requestTypes.slug,
      typeDisplayName: requestTypes.displayName,
      owner: { displayName: requestAssignees.displayName },
    })
    .from(requests)
    .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
    .leftJoin(requestAssignees, eq(requests.assigneeId, requestAssignees.id))
    .where(
      and(
        eq(requests.number, number),
        // The scoping is part of the lookup rather than a check
        // after it, so there is no branch where the row was read
        // and then refused.
        eq(requests.requesterId, user.id),
        isNull(requests.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw httpError(404, NO_REQUEST);

  let redirectTo: { module: "contract" | "matter"; number: number } | null = null;
  let recordArchived = false;
  if (row.status === "converted") {
    const module = row.convertedMatterId ? "matter" : "contract";
    const targetId = row.convertedMatterId ?? row.convertedContractId;
    const target = module === "contract" ? contracts : matters;
    if (!targetId) throw httpError(404, NO_REQUEST);
    const [destination] = await db
      .select({ number: target.number, archivedAt: target.archivedAt })
      .from(target)
      .where(eq(target.id, targetId))
      .limit(1);
    if (!destination) throw httpError(404, NO_REQUEST);
    recordArchived = destination.archivedAt !== null;
    if (!recordArchived) {
      const [allowed] = await db
        .select({ id: target.id })
        .from(target)
        .where(and(eq(target.id, targetId), portalRecordScope(db, user, module)))
        .limit(1);
      if (!allowed) throw httpError(404, NO_REQUEST);
      redirectTo = { module, number: destination.number };
    }
  }

  const [attached, attachments] = await Promise.all([
    readIntakeForm(db, row.typeId, { includeArchived: true }),
    row.status === "converted" ? [] : selectAttachments(db, row.id),
  ]);
  const readableFields = attached.fields;
  return {
    redirectTo,
    recordArchived,
    request: {
      ...toPortalRequestRow(row),
      description: row.description,
      departmentId: row.departmentId,
      department: await departmentName(db, row.departmentId),
      urgency: row.urgency,
      customFields: row.customFields,
      declinedReason: row.declinedReason,
    },
    fields: readableFields,
    customFieldRefs: await resolveRefs(db, readableFields, row.customFields),
    attachments,
  };
}

export async function readRequest(db: Db, user: AuthenticatedUser, number: number) {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
  const row = await staffRequestRow(db, user, number);
  const [attached, attachments] = await Promise.all([
    readIntakeForm(db, row.typeId, { includeArchived: true }),
    row.status === "converted" ? [] : selectAttachments(db, row.id),
  ]);
  const [conversion] =
    row.status === "converted"
      ? await db
          .select({ at: activityLog.createdAt, by: users.displayName })
          .from(activityLog)
          .leftJoin(users, eq(users.id, activityLog.actorId))
          .where(
            and(
              eq(activityLog.entityType, "request"),
              eq(activityLog.entityId, row.id),
              eq(activityLog.action, "request.converted"),
            ),
          )
          .orderBy(asc(activityLog.createdAt), asc(activityLog.id))
          .limit(1)
      : [];
  const readableFields = attached.fields;
  return {
    conversion: conversion ? { at: conversion.at.toISOString(), by: conversion.by } : null,
    request: toStaffRequest(row),
    fields: readableFields,
    customFieldRefs: await resolveStaffRefs(db, readableFields, row.customFields, user),
    attachments,
  };
}
