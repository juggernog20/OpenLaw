// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The approver-group templates (CTR-012, #231): the Settings →
 * Contracts → Approver groups pane's machinery — list, create with a
 * member list, rename, describe, replace the members, archive, and
 * restore.
 *
 * A group is a template and nothing else. Applying one snapshots its
 * members into approval requests (M14's apply ticket), so nothing here
 * needs an archive guard: an archived group only leaves the apply
 * picker, and every request it already produced is untouched. That is
 * why this module hand-rolls the list-editor shape rather than mounting
 * `taxonomy-routes` — a group has no slug, no display order, and no
 * reassignment story.
 *
 * Members must be Member+ users (CTR-012, DD-013): a Contributor or a
 * Business User is refused, as is an archived person, because a request
 * nobody can act on is worse than no request. Everything sits behind
 * SET-002's single role gate — Administrators only — and every mutation
 * appends to the activity log at `admin_only` (DD-017) inside the same
 * transaction.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  approverGroupMembers,
  approverGroups,
  asc,
  eq,
  inArray,
  isNull,
  users,
  type ApproverGroup,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { eligibleApprovers } from "../../lib/approvers.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const MemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
});

const ApproverGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** The template's people, in display-name order. */
  members: z.array(MemberSchema),
  /** The row's meta caption on the pane (DES-020). */
  memberCount: z.number().int(),
});

const ApproverGroupEnvelope = z.object({ approverGroup: ApproverGroupSchema });
const ApproverGroupListEnvelope = z.object({ approverGroups: z.array(ApproverGroupSchema) });

const NameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);
/** A member set, as the pane sends it; duplicates are collapsed. */
const MemberIdsSchema = z.array(z.string()).max(100);

interface MemberRow {
  id: string;
  displayName: string;
  email: string;
}

function toRow(row: ApproverGroup, members: MemberRow[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    members,
    memberCount: members.length,
  };
}

export const approverGroupsRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * The members of every named group, keyed by group id and ordered the
   * way the pane renders them. One query for the whole list, so the pane
   * costs two round trips rather than one per row.
   */
  async function membersOf(db: Executor, ids: string[]): Promise<Map<string, MemberRow[]>> {
    const byGroup = new Map<string, MemberRow[]>();
    if (ids.length === 0) return byGroup;
    const rows = await db
      .select({
        groupId: approverGroupMembers.groupId,
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(approverGroupMembers)
      .innerJoin(users, eq(users.id, approverGroupMembers.userId))
      .where(inArray(approverGroupMembers.groupId, ids))
      .orderBy(asc(users.displayName), asc(users.id));
    for (const row of rows) {
      const list = byGroup.get(row.groupId) ?? [];
      list.push({ id: row.id, displayName: row.displayName, email: row.email });
      byGroup.set(row.groupId, list);
    }
    return byGroup;
  }

  /** One group as its envelope value, with its member list. */
  async function rowJson(row: ApproverGroup) {
    return toRow(row, (await membersOf(app.db, [row.id])).get(row.id) ?? []);
  }

  /** Locks and returns one group, or 404s — every :id route starts here. */
  async function lockedGroup(tx: Transaction, id: string): Promise<ApproverGroup> {
    const [row] = await tx
      .select()
      .from(approverGroups)
      .where(eq(approverGroups.id, id))
      .limit(1)
      .for("update");
    if (!row) throw httpError(404, "No approver group exists with this id.");
    return row;
  }

  /**
   * The CTR-012 membership rule, checked once for a whole set: every id
   * must name a live Member+ user. The rule itself is shared with the
   * contract's own approval request (#233) — a template must never hold
   * somebody the record would then refuse — and only the archived
   * sentence differs, because a template holds members and a record
   * asks people.
   */
  async function eligibleMembers(tx: Transaction, ids: string[]): Promise<MemberRow[]> {
    return eligibleApprovers(
      tx,
      ids,
      (displayName) => `${displayName} is archived and can't be a group member.`,
    );
  }

  app.get(
    "/approver-groups",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listApproverGroups",
        summary:
          "The CTR-012 approver-group templates in name order, each " +
          "carrying its member list; archived groups only with " +
          "includeArchived=true",
        tags: ["approver-groups"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: { 200: ApproverGroupListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db
        .select()
        .from(approverGroups)
        .where(
          request.query.includeArchived === "true" ? undefined : isNull(approverGroups.archivedAt),
        )
        .orderBy(asc(approverGroups.name), asc(approverGroups.createdAt));
      const members = await membersOf(
        app.db,
        rows.map((row) => row.id),
      );
      return { approverGroups: rows.map((row) => toRow(row, members.get(row.id) ?? [])) };
    },
  );

  app.post(
    "/approver-groups",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createApproverGroup",
        summary:
          "Create an approver-group template with its name, an optional " +
          "description, and an optional starting member list; members " +
          "must be live Member+ users",
        tags: ["approver-groups"],
        body: z.object({
          name: NameSchema,
          description: DescriptionSchema.optional(),
          memberIds: MemberIdsSchema.optional(),
        }),
        response: { 201: ApproverGroupEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      const description = request.body.description?.trim() || null;
      const memberIds = [...new Set(request.body.memberIds ?? [])];

      const row = await app.db.transaction(async (tx) => {
        const members = await eligibleMembers(tx, memberIds);
        const [created] = await tx.insert(approverGroups).values({ name, description }).returning();
        if (members.length > 0) {
          await tx
            .insert(approverGroupMembers)
            .values(members.map((member) => ({ groupId: created!.id, userId: member.id })));
        }
        // One entry, not one per starting member: creating the template
        // is a single act, and the payload says who it started with.
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "approver_group.created",
          visibility: "admin_only",
          payload: {
            displayName: name,
            description,
            memberCount: members.length,
            memberNames: members.map((member) => member.displayName),
          },
        });
        return created!;
      });
      return reply.status(201).send({ approverGroup: await rowJson(row) });
    },
  );

  app.patch(
    "/approver-groups/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateApproverGroup",
        summary:
          "Rename an approver group (DES-017 in-place rename) and/or " +
          "change its description; the two changes write their own " +
          "activity entries",
        tags: ["approver-groups"],
        params: z.object({ id: z.string() }),
        // Strict: the member list has its own route, so a body carrying
        // `memberIds` is refused rather than silently ignored.
        body: z
          .strictObject({
            name: NameSchema.optional(),
            description: DescriptionSchema.nullable().optional(),
          })
          .refine(
            (body) => body.name !== undefined || body.description !== undefined,
            "Send a name, a description, or both.",
          ),
        response: { 200: ApproverGroupEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const name = request.body.name?.trim();
      const description =
        request.body.description === undefined
          ? undefined
          : (request.body.description?.trim() ?? "") || null;

      const row = await app.db.transaction(async (tx) => {
        const target = await lockedGroup(tx, request.params.id);
        const nameChanged = name !== undefined && name !== target.name;
        const descriptionChanged = description !== undefined && description !== target.description;
        // Nothing to save: answer with the row and write no misleading
        // from==to entry.
        if (!nameChanged && !descriptionChanged) return target;

        const [updated] = await tx
          .update(approverGroups)
          .set({
            ...(nameChanged ? { name } : {}),
            ...(descriptionChanged ? { description } : {}),
          })
          .where(eq(approverGroups.id, target.id))
          .returning();

        // A rename and a description edit are two facts about the
        // template, so the audit log holds them as two entries rather
        // than one entry an Administrator has to unpack.
        if (nameChanged) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "approver_group.renamed",
            visibility: "admin_only",
            payload: { displayName: name, from: target.name, to: name },
          });
        }
        if (descriptionChanged) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "approver_group.updated",
            visibility: "admin_only",
            // The taxonomy `changed` shape, so the M9 viewer's shared
            // `updated` sentence narrates it without a special case.
            payload: {
              displayName: updated!.name,
              changed: { description: { from: target.description, to: description } },
            },
          });
        }
        return updated!;
      });
      return { approverGroup: await rowJson(row) };
    },
  );

  app.put(
    "/approver-groups/:id/members",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setApproverGroupMembers",
        summary:
          "Replace an approver group's member list; every id must name a " +
          "live Member+ user, and each person added or removed writes " +
          "its own activity entry",
        tags: ["approver-groups"],
        params: z.object({ id: z.string() }),
        body: z.object({ memberIds: MemberIdsSchema }),
        response: { 200: ApproverGroupEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const memberIds = [...new Set(request.body.memberIds)];

      const row = await app.db.transaction(async (tx) => {
        const target = await lockedGroup(tx, request.params.id);
        const wanted = await eligibleMembers(tx, memberIds);
        const wantedIds = new Set(wanted.map((member) => member.id));

        const current = await tx
          .select({
            userId: approverGroupMembers.userId,
            displayName: users.displayName,
          })
          .from(approverGroupMembers)
          .innerJoin(users, eq(users.id, approverGroupMembers.userId))
          .where(eq(approverGroupMembers.groupId, target.id))
          .for("update", { of: approverGroupMembers });
        const currentIds = new Set(current.map((member) => member.userId));

        const added = wanted.filter((member) => !currentIds.has(member.id));
        const removed = current.filter((member) => !wantedIds.has(member.userId));

        if (removed.length > 0) {
          await tx.delete(approverGroupMembers).where(
            and(
              eq(approverGroupMembers.groupId, target.id),
              inArray(
                approverGroupMembers.userId,
                removed.map((member) => member.userId),
              ),
            ),
          );
        }
        if (added.length > 0) {
          await tx
            .insert(approverGroupMembers)
            .values(added.map((member) => ({ groupId: target.id, userId: member.id })));
        }

        // A list that arrived unchanged is not an event: with nothing
        // added and nothing removed there is no entry to append, and an
        // empty INSERT is not a statement Postgres accepts.
        if (added.length === 0 && removed.length === 0) return target;

        // A person joining or leaving a template is its own fact, so the
        // audit log names each one — the same rule the contract team's
        // entries follow (CTR-004).
        await recordActivity(tx, [
          ...added.map((member) => ({
            entityType: "system" as const,
            actorId: request.user.id,
            action: "approver_group.member_added" as const,
            visibility: "admin_only" as const,
            payload: {
              displayName: target.name,
              memberId: member.id,
              memberName: member.displayName,
            },
          })),
          ...removed.map((member) => ({
            entityType: "system" as const,
            actorId: request.user.id,
            action: "approver_group.member_removed" as const,
            visibility: "admin_only" as const,
            payload: {
              displayName: target.name,
              memberId: member.userId,
              memberName: member.displayName,
            },
          })),
        ]);
        return target;
      });
      return { approverGroup: await rowJson(row) };
    },
  );

  app.post(
    "/approver-groups/:id/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveApproverGroup",
        summary:
          "Archive an approver group (SET-003): it leaves the apply " +
          "picker and the default list. No guard and no reassignment — " +
          "applying a group snapshots its members (CTR-012), so every " +
          "request it already produced is untouched",
        tags: ["approver-groups"],
        params: z.object({ id: z.string() }),
        response: { 200: ApproverGroupEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedGroup(tx, request.params.id);
        if (target.archivedAt) throw httpError(409, "This approver group is already archived.");
        const [updated] = await tx
          .update(approverGroups)
          .set({ archivedAt: new Date() })
          .where(eq(approverGroups.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "approver_group.archived",
          visibility: "admin_only",
          payload: { displayName: target.name },
        });
        return updated!;
      });
      return { approverGroup: await rowJson(row) };
    },
  );

  app.post(
    "/approver-groups/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreApproverGroup",
        summary:
          "Restore an archived approver group (SET-003's recovery story); " +
          "its members ride along unchanged",
        tags: ["approver-groups"],
        params: z.object({ id: z.string() }),
        response: { 200: ApproverGroupEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedGroup(tx, request.params.id);
        if (!target.archivedAt) throw httpError(409, "This approver group is not archived.");
        const [updated] = await tx
          .update(approverGroups)
          .set({ archivedAt: null })
          .where(eq(approverGroups.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "approver_group.restored",
          visibility: "admin_only",
          payload: { displayName: target.name },
        });
        return updated!;
      });
      return { approverGroup: await rowJson(row) };
    },
  );
};
