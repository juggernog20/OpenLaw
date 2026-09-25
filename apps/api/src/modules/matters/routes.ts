// SPDX-License-Identifier: AGPL-3.0-only

import { formForTouchpoint } from "@openlaw/shared";
import { listAssignableUsers } from "../../lib/assignable-users.js";
import { FormNodeSchema, readTypeForm } from "../../lib/type-form-routes.js";

/** The first matter surface: list, create, options, and record read. */
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  MATTER_PROGRESSION_GROUPS,
  matters,
  matterStatuses,
  matterTemplateKeyDates,
  matterTemplates,
  matterTemplateTasks,
  matterTypeFields,
  matterTypes,
  USER_ROLES,
  users,
} from "@openlaw/db";
import { MATTER_REOPEN_CONFIRMATION_PROBLEM_TYPE, MAX_MATTER_TITLE_LENGTH } from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import { civilToday } from "../../lib/contract-term.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { addToMatterTeam, removeMatterTeamMember } from "../../lib/matter-team.js";
import { setMatterParent } from "../../lib/matter-relations.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import { FilterOptionsSchema } from "../../lib/record-filters.js";
import { departmentName, departmentOptions } from "../departments/references.js";
import { regionOptions } from "../regions/references.js";
import { createMatter } from "./create.js";
import {
  lockedMatter,
  MatterEnvelope,
  MatterLifecycleEnvelope,
  MatterListQuery,
  MatterPatchBody,
  MatterRecordEnvelope,
  MatterRowSchema,
  MatterTeamEnvelope,
  NumberParams,
  OpenChildSchema,
  PersonSchema,
  scope,
  selectMatters,
  SeveritySchema,
  toRow,
} from "./record.js";
import { getMatter, listMatters, patchMatter } from "./service.js";

const requireMember = requireRole("administrator", "legal_team_member");
const requireReader = requireRole("administrator", "legal_team_member");

export const mattersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/matters",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatters",
        summary:
          "The managed Matters list, filtered and keyset-paged after access scope, with active counts",
        tags: ["matters"],
        querystring: MatterListQuery,
        response: {
          200: z.object({
            matters: z.array(MatterRowSchema),
            total: z.number().int(),
            nextCursor: z.string().nullable(),
            counts: z.object({ open: z.number().int(), onHold: z.number().int() }),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => listMatters(app.db, request.user, request.query),
  );

  app.get(
    "/matters/filter-options",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterFilterOptions",
        tags: ["matters"],
        response: { 200: FilterOptionsSchema, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db
        .selectDistinct({
          typeId: matters.matterTypeId,
          typeName: matterTypes.displayName,
          statusId: matters.statusId,
          statusName: matterStatuses.displayName,
          personId: users.id,
          personName: users.displayName,
        })
        .from(matters)
        .innerJoin(matterTypes, eq(matters.matterTypeId, matterTypes.id))
        .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
        .leftJoin(users, eq(matters.managerId, users.id))
        .where(scope(app.db, request.user));
      const unique = (values: { id: string; displayName: string }[]) =>
        [...new Map(values.map((value) => [value.id, value])).values()].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
      const businessOwners = await app.db
        .selectDistinct({ id: users.id, displayName: users.displayName })
        .from(matters)
        .innerJoin(users, eq(users.id, matters.businessOwnerId))
        .where(scope(app.db, request.user));
      return {
        businessOwners: unique(businessOwners),
        types: unique(rows.map((row) => ({ id: row.typeId, displayName: row.typeName }))),
        statuses: unique(rows.map((row) => ({ id: row.statusId, displayName: row.statusName }))),
        people: unique(
          rows.flatMap((row) =>
            row.personId && row.personName
              ? [{ id: row.personId, displayName: row.personName }]
              : [],
          ),
        ),
      };
    },
  );

  app.get(
    "/matters/options",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterOptions",
        summary:
          "Live Matter types with Forms, creation trees, Field definitions and templates; Statuses and assignable people",
        tags: ["matters"],
        response: {
          200: z.object({
            matterTypes: z.array(
              z.object({
                id: z.string(),
                slug: z.string(),
                displayName: z.string(),
                form: z.array(FormNodeSchema).optional(),
                creationForm: z.array(FormNodeSchema).optional(),
                isDefault: z.boolean().optional(),
                fields: z.array(AttachedCustomFieldSchema),
                templates: z.array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    description: z.string().nullable(),
                    defaultPriority: SeveritySchema.nullable(),
                    defaultRisk: SeveritySchema.nullable(),
                    defaultCustomFields: CustomFieldsSchema,
                    titlePrefix: z.string().nullable(),
                    taskCount: z.number().int(),
                    keyDateCount: z.number().int(),
                  }),
                ),
              }),
            ),
            matterStatuses: z.array(
              z.object({
                id: z.string(),
                slug: z.string(),
                displayName: z.string(),
                category: z.enum(["open", "closed"]),
                progressionGroup: z.enum(MATTER_PROGRESSION_GROUPS),
              }),
            ),
            users: z.array(PersonSchema.extend({ role: z.enum(USER_ROLES) })),
            departments: z.array(z.object({ id: z.string(), displayName: z.string() })),
            regions: z.array(z.object({ id: z.string(), displayName: z.string() })),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [types, statuses, people, templates, taskCounts, keyDateCounts] = await Promise.all([
        app.db
          .select({
            id: matterTypes.id,
            slug: matterTypes.slug,
            displayName: matterTypes.displayName,
            isDefault: matterTypes.isDefault,
          })
          .from(matterTypes)
          .where(isNull(matterTypes.archivedAt))
          .orderBy(asc(matterTypes.displayOrder), asc(matterTypes.createdAt)),
        app.db
          .select({
            id: matterStatuses.id,
            slug: matterStatuses.slug,
            displayName: matterStatuses.displayName,
            category: matterStatuses.category,
            progressionGroup: matterStatuses.progressionGroup,
          })
          .from(matterStatuses)
          .where(isNull(matterStatuses.archivedAt))
          .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.createdAt)),
        listAssignableUsers(app.db),
        app.db
          .select()
          .from(matterTemplates)
          .where(isNull(matterTemplates.archivedAt))
          .orderBy(asc(matterTemplates.matterTypeId), asc(matterTemplates.name)),
        app.db
          .select({ templateId: matterTemplateTasks.matterTemplateId, tally: count() })
          .from(matterTemplateTasks)
          .groupBy(matterTemplateTasks.matterTemplateId),
        app.db
          .select({ templateId: matterTemplateKeyDates.matterTemplateId, tally: count() })
          .from(matterTemplateKeyDates)
          .groupBy(matterTemplateKeyDates.matterTemplateId),
      ]);
      const attached = await Promise.all(
        types.map((type) => selectAttachedFields(app.db, matterTypeFields, type.id)),
      );
      const forms = await Promise.all(types.map((type) => readTypeForm(app.db, "matter", type.id)));
      const taskCountByTemplate = new Map(
        taskCounts.map((row) => [row.templateId, row.tally] as const),
      );
      const keyDateCountByTemplate = new Map(
        keyDateCounts.map((row) => [row.templateId, row.tally] as const),
      );
      const templatesByType = new Map<string, typeof templates>();
      for (const template of templates) {
        const rows = templatesByType.get(template.matterTypeId) ?? [];
        rows.push(template);
        templatesByType.set(template.matterTypeId, rows);
      }
      return {
        departments: await departmentOptions(app.db),
        regions: await regionOptions(app.db),
        matterTypes: types.map((type, index) => {
          const visibleSlugs = new Set(
            attached[index]!.filter(
              (field) => request.user.role !== "business_user" || field.visibleOnPortal,
            ).map((field) => field.slug),
          );
          return {
            ...type,
            fields: attached[index]!,
            form: forms[index]!,
            creationForm: formForTouchpoint(forms[index]!, "creation"),
            templates: (templatesByType.get(type.id) ?? []).map((template) => ({
              id: template.id,
              name: template.name,
              description: template.description,
              defaultPriority: template.defaultPriority,
              defaultRisk: template.defaultRisk,
              defaultCustomFields: Object.fromEntries(
                Object.entries(template.defaultCustomFields ?? {}).filter(([slug]) =>
                  visibleSlugs.has(slug),
                ),
              ),
              titlePrefix: template.titlePrefix,
              taskCount: taskCountByTemplate.get(template.id) ?? 0,
              keyDateCount: keyDateCountByTemplate.get(template.id) ?? 0,
            })),
          };
        }),
        matterStatuses: statuses,
        users: people.map((person) => ({
          id: person.id,
          displayName: person.displayName,
          image: person.image,
          // The query admits live users only, so this is always false.
          archived: false,
          role: person.role,
        })),
      };
    },
  );

  app.get(
    "/matters/:number",
    {
      preHandler: requireReader,
      schema: {
        operationId: "getMatter",
        summary: "Read one matter by its M-number, including its type-driven fields",
        tags: ["matters"],
        params: NumberParams,
        response: { 200: MatterRecordEnvelope, default: problemResponse },
      },
    },
    async (request) => getMatter(app.db, request.user, request.params.number),
  );

  app.get(
    "/matters/:number/lifecycle",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getMatterLifecycle",
        summary:
          "Live Status choices for deliberate Closing or reopening, with a non-blocking open-child advisory",
        tags: ["matters"],
        params: NumberParams,
        response: { 200: MatterLifecycleEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const current = await reachedMatter(app.db, request.user, request.params.number);
      if (!current) throw httpError(404, NO_MATTER);
      if (current.archivedAt) {
        throw httpError(409, "This matter is archived. Restore it before changing its Status.");
      }
      const [currentStatus] = await app.db
        .select({ category: matterStatuses.category })
        .from(matterStatuses)
        .where(eq(matterStatuses.id, current.statusId))
        .limit(1);
      if (!currentStatus) throw httpError(404, NO_MATTER);
      const targetCategory: "open" | "closed" =
        currentStatus.category === "open" ? "closed" : "open";
      const statuses = await app.db
        .select({ id: matterStatuses.id, displayName: matterStatuses.displayName })
        .from(matterStatuses)
        .where(and(eq(matterStatuses.category, targetCategory), isNull(matterStatuses.archivedAt)))
        .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.createdAt));

      let openChildren: z.infer<typeof OpenChildSchema>[] = [];
      if (targetCategory === "closed") {
        const children = await app.db
          .select({ id: matters.id })
          .from(matters)
          .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
          .where(
            and(
              eq(matters.parentId, current.id),
              eq(matterStatuses.category, "open"),
              isNull(matters.archivedAt),
            ),
          )
          .orderBy(asc(matters.number));
        const childIds = children.map((child) => child.id);
        const reachable =
          childIds.length === 0
            ? []
            : await app.db
                .select({ id: matters.id, number: matters.number, title: matters.title })
                .from(matters)
                .where(and(inArray(matters.id, childIds), matterTeamScope(app.db, request.user)));
        const identities = new Map(reachable.map((child) => [child.id, child]));
        openChildren = children.map((child) => {
          const identity = identities.get(child.id);
          return identity
            ? {
                restricted: false as const,
                number: identity.number,
                title: identity.title,
              }
            : { restricted: true as const };
        });
      }
      const action: "close" | "reopen" = targetCategory === "closed" ? "close" : "reopen";
      return {
        action,
        targetCategory,
        statuses,
        openChildren,
      };
    },
  );

  app.post(
    "/matters",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createMatter",
        summary:
          "Create the next M-number on the first live open Status, enforcing Required on visible creation Rows",
        tags: ["matters"],
        body: z.strictObject({
          title: z.string().trim().min(1).max(MAX_MATTER_TITLE_LENGTH),
          matterTypeId: z.string(),
          neededBy: z.iso.date().nullable().optional(),
          managerId: z.string().nullable().optional(),
          departmentId: z.string().min(1).nullable().optional(),
          region: z.string().trim().max(200).nullable().optional(),
          priority: SeveritySchema.optional(),
          risk: SeveritySchema.nullable().optional(),
          description: z.string().trim().max(10_000).nullable().optional(),
          customFields: CustomFieldsInput.optional(),
          isConfidential: z.boolean().optional(),
          parentMatterNumber: z.coerce.number().int().positive().optional(),
          templateId: z.string().optional(),
        }),
        response: { 201: MatterEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const created = await app.db.transaction(async (tx) => {
        const { parentMatterNumber, ...body } = request.body;
        const parent = parentMatterNumber
          ? await reachedMatter(tx, request.user, parentMatterNumber, { lock: true })
          : null;
        if (parentMatterNumber && !parent) throw httpError(404, NO_MATTER);
        if (parent?.archivedAt) {
          throw httpError(409, "That parent Matter is archived. Restore it before using it.");
        }
        const next = await createMatter(tx, { ...body, actorId: request.user.id });
        if (parent) {
          await setMatterParent(tx, next.row.id, parent.id);
          await recordActivity(tx, {
            entityType: "matter",
            entityId: next.row.id,
            actorId: request.user.id,
            action: "matter.parent_set",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              number: next.row.number,
              title: next.row.title,
              parentNumber: parent.number,
              parentTitle: parent.title,
            },
          });
        }
        return next;
      });
      return reply.status(201).send({
        matter: {
          ...toRow(created),
          department: await departmentName(app.db, created.row.departmentId),
        },
      });
    },
  );

  app.patch(
    "/matters/:number",
    {
      preHandler: requireReader,
      schema: {
        operationId: "updateMatter",
        summary:
          "Commit matter fields individually, including re-type gaps, unrestricted live status transitions, and confidentiality",
        tags: ["matters"],
        params: NumberParams,
        body: MatterPatchBody,
        response: {
          200: MatterRecordEnvelope,
          409: problemTypeResponse("Reopening requires explicit confirmation", [
            MATTER_REOPEN_CONFIRMATION_PROBLEM_TYPE,
          ]),
          default: problemResponse,
        },
      },
    },
    async (request) => patchMatter(app.db, request.user, request.params.number, request.body),
  );

  app.post(
    "/matters/:number/team",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addMatterTeamMember",
        summary: "Add one person to a matter team",
        tags: ["matters"],
        params: NumberParams,
        body: z.strictObject({ userId: z.string() }),
        response: { 201: MatterTeamEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        return addToMatterTeam(tx, current, request.user, request.body.userId);
      });
      return reply.status(201).send({ team });
    },
  );

  app.delete(
    "/matters/:number/team/:userId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeMatterTeamMember",
        summary:
          "Remove one person from a matter team; reassign or clear the current Business Owner first",
        tags: ["matters"],
        params: NumberParams.extend({ userId: z.string() }),
        response: { 200: MatterTeamEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        return removeMatterTeamMember(tx, current, request.user, request.params.userId);
      });
      return { team };
    },
  );

  app.post(
    "/matters/:number/archive",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveMatter",
        summary: "Archive a matter so it leaves the default list",
        tags: ["matters"],
        params: NumberParams,
        response: { 200: MatterEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const today = civilToday();
      const archived = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        if (current.row.archivedAt) throw httpError(409, "This matter is already archived.");
        const [row] = await tx
          .update(matters)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(matters.id, current.row.id))
          .returning();
        await recordActivity(tx, {
          entityType: "matter",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "matter.archived",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      const [fresh] = await selectMatters(app.db, today)
        .where(eq(matters.id, archived.row.id))
        .limit(1);
      if (!fresh) throw httpError(404, NO_MATTER);
      return { matter: toRow(fresh) };
    },
  );

  app.post(
    "/matters/:number/restore",
    {
      preHandler: requireMember,
      schema: {
        operationId: "restoreMatter",
        summary: "Restore an archived matter to the default list",
        tags: ["matters"],
        params: NumberParams,
        response: { 200: MatterEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const today = civilToday();
      const restored = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        if (!current.row.archivedAt) throw httpError(409, "This matter is not archived.");
        const [row] = await tx
          .update(matters)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(matters.id, current.row.id))
          .returning();
        await recordActivity(tx, {
          entityType: "matter",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "matter.restored",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      const [fresh] = await selectMatters(app.db, today)
        .where(eq(matters.id, restored.row.id))
        .limit(1);
      if (!fresh) throw httpError(404, NO_MATTER);
      return { matter: toRow(fresh) };
    },
  );
};
