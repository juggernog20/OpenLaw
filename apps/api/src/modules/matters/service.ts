// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Matter list, get, update and status operations admit Administrators and
 * Legal Team Members (DD-013, DD-023). The shared PATCH keeps field edits,
 * status moves and their activity in one transaction (MTR-002, DD-017).
 */

import type { Db } from "@openlaw/db";
import {
  and,
  eq,
  isNull,
  matters,
  matterStatuses,
  matterTeam,
  matterTypeFields,
  matterTypes,
  sql,
  type Matter,
} from "@openlaw/db";
import { MATTER_REOPEN_CONFIRMATION_PROBLEM_TYPE } from "@openlaw/shared";
import { z } from "zod";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import { civilToday } from "../../lib/contract-term.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  projectCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { incompleteMatter } from "../../lib/incomplete-matter.js";
import { matterTeamScope, NO_MATTER } from "../../lib/matter-access.js";
import { nextDeadline } from "../../lib/next-deadline.js";
import { httpError } from "../../lib/problem.js";
import { choiceFilter, dateFilter } from "../../lib/record-filters.js";
import { recordPerson } from "../../lib/record-person.js";
import { readTypeForm } from "../../lib/type-form-routes.js";
import { departmentName, lockedDepartment } from "../departments/references.js";
import { lockedRegionName } from "../regions/references.js";
import { originalIntake } from "../requests/original-intake.js";
import { resolveStaffRefs } from "../requests/projection.js";
import {
  assertAudienceActor,
  assertEditable,
  furtherDownThan,
  listOrder,
  lockedLiveUser,
  lockedMatter,
  MatterListQuery,
  MatterPatchBody,
  MatterStatusBody,
  MatterUpdateBody,
  PAGE_SIZE,
  scope,
  selectMatters,
  selectTeam,
  toRow,
  type SortRequest,
} from "./record.js";

function assertReader(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}

export async function listMatters(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof MatterListQuery> = {},
) {
  assertReader(user);
  const query = MatterListQuery.parse(input);

  const today = civilToday();
  const sort: SortRequest | null = query.sort ? { key: query.sort, dir: query.dir ?? "asc" } : null;
  const predicates = and(
    query.includeArchived === "true" ? undefined : isNull(matters.archivedAt),
    query.includeClosed === "true" ? undefined : eq(matterStatuses.category, "open"),
    choiceFilter(matters.statusId, query.status),
    choiceFilter(matters.matterTypeId, query.type),
    choiceFilter(matters.priority, query.priority),
    choiceFilter(matters.risk, query.risk),
    choiceFilter(matters.managerId, query.manager, user.id),
    dateFilter(
      sql`(${matters.openedAt} at time zone ${query.timeZone ?? user.timezone ?? "UTC"})::date`,
      query.openedFrom,
      query.openedTo,
    ),
    dateFilter(
      sql`((${nextDeadline("matter", today)}) ->> 'date')::date`,
      query.deadlineFrom,
      query.deadlineTo,
    ),
    query.incomplete === "true" ? incompleteMatter : undefined,
    scope(db, user),
  );
  const rows = await selectMatters(db, today)
    .where(
      and(predicates, query.cursor ? furtherDownThan(db, query.cursor, user, sort) : undefined),
    )
    .orderBy(...listOrder(sort))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${matterStatuses.slug} = 'open')::int`,
      onHold: sql<number>`count(*) filter (where ${matterStatuses.slug} = 'on_hold')::int`,
    })
    .from(matters)
    .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
    .where(predicates);
  return {
    total: counts?.total ?? 0,
    matters: page.map((context) => toRow(context, context.row.customFields)),
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.row.id ?? null) : null,
    counts: { open: counts?.open ?? 0, onHold: counts?.onHold ?? 0 },
  };
}

export async function getMatter(db: Db, user: AuthenticatedUser, number: number) {
  assertReader(user);

  // Archiving hides a matter from the collection; it does not revoke
  // an existing M-number link, so this lookup intentionally has no archive filter.
  const [context] = await selectMatters(db)
    .where(and(eq(matters.number, number), matterTeamScope(db, user)))
    .limit(1);
  if (!context) throw httpError(404, NO_MATTER);
  const attached = await selectAttachedFields(db, matterTypeFields, context.row.matterTypeId);
  const projection = projectCustomFields(user.role, attached, context.row.customFields);
  return {
    matter: {
      ...toRow(context, projection.customFields),
      businessOwner: await recordPerson(db, context.row.businessOwnerId),
      department: await departmentName(db, context.row.departmentId),
    },
    creator: await recordPerson(db, context.row.createdBy),
    originalIntake: await originalIntake(db, user, "matter", context.row.id),
    form: await readTypeForm(db, "matter", context.row.matterTypeId),
    fields: projection.fields,
    customFieldRefs: await resolveStaffRefs(db, projection.fields, projection.customFields, user),
    team: await selectTeam(db, context.row.id),
  };
}

/** Preserves the HTTP PATCH transaction when fields and status arrive together. */
export async function patchMatter(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof MatterPatchBody>,
) {
  assertReader(user);
  const body = MatterPatchBody.parse(input);

  const today = civilToday();
  const written = await db.transaction(async (tx) => {
    const current = await lockedMatter(tx, number, user);
    if (body.isConfidential !== undefined) {
      await assertAudienceActor(
        tx,
        current,
        user,
        "Only an Administrator, the matter's creator, or its Matter Manager can change this.",
      );
    }
    // The Matter Manager reaches a confidential matter by being its
    // Manager, so naming one is an audience change. It takes the
    // same actor set the team routes do, asked at the same point:
    // before the archived refusal, and before the named person is
    // read.
    if (
      current.row.isConfidential &&
      body.managerId !== undefined &&
      body.managerId !== current.row.managerId
    ) {
      await assertAudienceActor(
        tx,
        current,
        user,
        "Only an Administrator, the matter's creator, or its Matter Manager can change the team on a confidential matter.",
      );
    }
    assertEditable(current);
    const target = current.row;
    const patch: Partial<Matter> = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};

    if (body.title !== undefined && body.title.trim() !== target.title) {
      patch.title = body.title.trim();
      changed.title = { from: target.title, to: patch.title };
    }
    if (body.description !== undefined) {
      const next = body.description?.trim() || null;
      if (next !== target.description) {
        patch.description = next;
        changed.description = { from: target.description, to: next };
      }
    }

    if (body.departmentId !== undefined && body.departmentId !== target.departmentId) {
      const next = body.departmentId ? await lockedDepartment(tx, body.departmentId) : null;
      patch.departmentId = next?.id ?? null;
      changed.department = {
        from: await departmentName(tx, target.departmentId),
        to: next?.displayName ?? null,
      };
    }
    if (body.region !== undefined && body.region !== target.region) {
      const next = await lockedRegionName(tx, body.region);
      patch.region = next;
      changed.region = { from: target.region, to: next };
    }
    if (body.businessOwnerId !== undefined && body.businessOwnerId !== target.businessOwnerId) {
      const next = body.businessOwnerId ? await lockedLiveUser(tx, body.businessOwnerId) : null;
      const previous = await recordPerson(tx, target.businessOwnerId);
      if (next) {
        if (target.isConfidential) {
          await assertAudienceActor(
            tx,
            current,
            user,
            "Only an Administrator, the matter's creator, or its Matter Manager can change the team on a confidential matter.",
          );
        }
        const inserted = await tx
          .insert(matterTeam)
          .values({ matterId: target.id, userId: next.id })
          .onConflictDoNothing()
          .returning();
        if (inserted.length > 0) {
          await recordActivity(tx, {
            entityType: "matter",
            entityId: target.id,
            actorId: user.id,
            action: "matter.team_added",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: target.number, title: target.title, member: next.displayName },
          });
        }
      }
      patch.businessOwnerId = next?.id ?? null;
      changed.businessOwner = {
        from: previous?.displayName ?? null,
        to: next?.displayName ?? null,
      };
    }
    let manager = current.manager;
    if (body.managerId !== undefined && body.managerId !== target.managerId) {
      manager = body.managerId ? await lockedLiveUser(tx, body.managerId, true) : null;
      patch.managerId = manager?.id ?? null;
      changed.matterManager = {
        from: current.manager?.displayName ?? null,
        to: manager?.displayName ?? null,
      };
    }
    if (body.priority !== undefined && body.priority !== target.priority) {
      patch.priority = body.priority;
      changed.priority = { from: target.priority, to: body.priority };
    }
    if (body.risk !== undefined && body.risk !== target.risk) {
      patch.risk = body.risk;
      changed.risk = { from: target.risk, to: body.risk };
    }

    let matterTypeName = current.matterTypeName;
    const retyped = body.matterTypeId !== undefined && body.matterTypeId !== target.matterTypeId;
    if (retyped) {
      const [matterType] = await tx
        .select({
          id: matterTypes.id,
          displayName: matterTypes.displayName,
          archivedAt: matterTypes.archivedAt,
        })
        .from(matterTypes)
        .where(eq(matterTypes.id, body.matterTypeId!))
        .limit(1)
        .for("update");
      if (!matterType || matterType.archivedAt) {
        throw httpError(400, "The matter type must be a live matter type.");
      }
      patch.matterTypeId = matterType.id;
      matterTypeName = matterType.displayName;
    }

    const attached = await selectAttachedFields(
      tx,
      matterTypeFields,
      patch.matterTypeId ?? target.matterTypeId,
    );
    if (body.customFields !== undefined || retyped) {
      const applied = await applyCustomFields(
        tx,
        attached,
        target.customFields,
        body.customFields ?? {},
      );
      if (retyped) {
        assertRequiredCustomFields(attached, applied.values);
      } else if (body.customFields !== undefined) {
        assertRequiredCustomFields(
          attached.filter((field) => field.slug in body.customFields!),
          applied.values,
        );
      }
      if (Object.keys(applied.changed).length > 0) {
        patch.customFields = applied.values;
        Object.assign(changed, applied.changed);
      }
    }

    let statusName = current.statusName;
    let statusCategory = current.statusCategory;
    let statusChange:
      | {
          from: string;
          to: string;
          fromCategory: "open" | "closed";
          toCategory: "open" | "closed";
        }
      | undefined;
    if (body.statusId !== undefined && body.statusId !== target.statusId) {
      const [status] = await tx
        .select({
          id: matterStatuses.id,
          displayName: matterStatuses.displayName,
          category: matterStatuses.category,
          progressionGroup: matterStatuses.progressionGroup,
          archivedAt: matterStatuses.archivedAt,
        })
        .from(matterStatuses)
        .where(eq(matterStatuses.id, body.statusId))
        .limit(1)
        .for("update");
      if (!status || status.archivedAt) {
        throw httpError(400, "The status must be a live matter status.");
      }
      patch.statusId = status.id;
      statusChange = {
        from: current.statusName,
        to: status.displayName,
        fromCategory: current.statusCategory,
        toCategory: status.category,
      };
      statusName = status.displayName;
      statusCategory = status.category;
      if (current.statusCategory === "open" && status.category === "closed") {
        if (!body.closingNote)
          throw httpError(400, "Enter a closing note before closing this Matter.");
        patch.closedAt = new Date();
      } else if (current.statusCategory === "closed" && status.category === "open") {
        if (!body.confirmReopen)
          throw httpError(409, "Confirm before reopening this Matter.", {
            type: MATTER_REOPEN_CONFIRMATION_PROBLEM_TYPE,
          });
        patch.closedAt = null;
      }
    }

    if (
      body.closingNote !== undefined &&
      !(statusChange?.fromCategory === "open" && statusChange.toCategory === "closed")
    ) {
      throw httpError(400, "A closing note can only accompany closing an open Matter.");
    }

    let confidentialityChange: boolean | undefined;
    if (body.isConfidential !== undefined && body.isConfidential !== target.isConfidential) {
      patch.isConfidential = body.isConfidential;
      confidentialityChange = body.isConfidential;
    }

    if (target.aiUnverified) {
      const flags = { ...target.aiUnverified };
      for (const [key, slug] of Object.entries({
        title: "title",
        description: "description",
        priority: "priority",
        matterTypeId: "matter_type",
      }))
        if (key in patch) delete flags[slug];
      for (const slug of Object.keys(body.customFields ?? {}))
        if (
          JSON.stringify((patch.customFields ?? target.customFields)[slug]) !==
          JSON.stringify(target.customFields[slug])
        )
          delete flags[`field:${slug}`];
      if (retyped)
        for (const slug of Object.keys(flags)) if (slug.startsWith("field:")) delete flags[slug];
      // Only deletions happen above, so a shorter map is a real change.
      // Writing an unchanged map would bump updatedAt on a no-op PATCH.
      if (Object.keys(flags).length !== Object.keys(target.aiUnverified).length)
        patch.aiUnverified = Object.keys(flags).length ? flags : null;
    }
    let row: Matter = target;
    if (Object.keys(patch).length > 0) {
      const [written] = await tx
        .update(matters)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(matters.id, target.id))
        .returning();
      row = written!;
    }
    if (Object.keys(changed).length > 0) {
      await recordActivity(tx, {
        entityType: "matter",
        entityId: target.id,
        actorId: user.id,
        action: "matter.updated",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          number: row.number,
          title: row.title,
          changed,
        },
      });
    }
    if (retyped) {
      await recordActivity(tx, {
        entityType: "matter",
        entityId: target.id,
        actorId: user.id,
        action: "matter.type_reassigned",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          number: row.number,
          title: row.title,
          from: current.matterTypeName,
          to: matterTypeName,
        },
      });
    }
    if (statusChange) {
      await recordActivity(tx, {
        entityType: "matter",
        entityId: target.id,
        actorId: user.id,
        action: "matter.status_changed",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          number: row.number,
          title: row.title,
          ...statusChange,
          ...(body.closingNote ? { closingNote: body.closingNote } : {}),
        },
      });
    }
    if (confidentialityChange !== undefined) {
      await recordActivity(tx, {
        entityType: "matter",
        entityId: target.id,
        actorId: user.id,
        action: confidentialityChange
          ? "matter.confidentiality_set"
          : "matter.confidentiality_cleared",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { number: row.number, title: row.title },
      });
    }
    return { row, matterTypeName, statusName, statusCategory, manager, attached };
  });
  const [updated] = await selectMatters(db, today).where(eq(matters.id, written.row.id)).limit(1);
  if (!updated) throw httpError(404, NO_MATTER);
  const projection = projectCustomFields(user.role, written.attached, updated.row.customFields);
  return {
    matter: {
      ...toRow(updated, projection.customFields),
      businessOwner: await recordPerson(db, updated.row.businessOwnerId),
      department: await departmentName(db, updated.row.departmentId),
    },
    fields: projection.fields,
    customFieldRefs: await resolveStaffRefs(db, projection.fields, projection.customFields, user),
    team: await selectTeam(db, updated.row.id),
  };
}

export type UpdateMatterInput = z.input<typeof MatterUpdateBody>;

export async function updateMatter(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof MatterUpdateBody>,
) {
  // patchMatter asserts the reader; a second check here would only
  // repeat it.
  return patchMatter(db, user, number, MatterUpdateBody.parse(input));
}

export type SetMatterStatusInput = z.input<typeof MatterStatusBody>;

export async function setMatterStatus(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof MatterStatusBody>,
) {
  return patchMatter(db, user, number, MatterStatusBody.parse(input));
}
