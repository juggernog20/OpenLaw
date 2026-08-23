// SPDX-License-Identifier: AGPL-3.0-only

/** The first matter surface: list, create, options, and record read. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  fields,
  isNull,
  matters,
  matterStatuses,
  matterTeam,
  matterTypeFields,
  matterTypes,
  MATTER_TEAM_ROLES,
  SEVERITY_LEVELS,
  sql,
  users,
  USER_ROLES,
  type AnyPgColumn,
  type Executor,
  type Matter,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import {
  MAX_MATTER_TITLE_LENGTH,
  MATTER_SORT_KEYS,
  SORT_DIRECTIONS,
  type MatterSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import {
  MATTER_CREATOR_ROLE,
  MATTER_MANAGER_REFUSAL,
  MATTER_MANAGER_ROLES,
  matterConfidentialityWrite,
  matterTeamScope,
  NO_MATTER,
  reachedMatter,
} from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { resolveStaffRefs, StaffRequestCustomFieldRefsSchema } from "../requests/projection.js";
import { createMatter } from "./create.js";

const requireMember = requireRole("administrator", "legal_team_member");
const requireReader = requireRole("administrator", "legal_team_member", "contributor");
const SeveritySchema = z.enum(SEVERITY_LEVELS);
const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const PAGE_SIZE = 50;
const CursorSchema = z.string().min(1).max(64);

interface SortRequest {
  key: MatterSortKey;
  dir: SortDirection;
}

function severityRank(column: AnyPgColumn): SQL {
  const arms = SEVERITY_LEVELS.map(
    (level, index) => sql`when ${level} then ${sql.raw(String(index + 1))}`,
  );
  return sql`case ${column} ${sql.join(arms, sql` `)} end`;
}

const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const MatterRowSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  matterTypeId: z.string(),
  matterTypeName: z.string(),
  statusId: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(["open", "closed"]),
  manager: PersonSchema.nullable(),
  priority: SeveritySchema,
  risk: SeveritySchema.nullable(),
  customFields: CustomFieldsSchema,
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  isConfidential: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const MatterEnvelope = z.object({ matter: MatterRowSchema });
/** The record plus the fields its type attaches and the people and
 * Entities its stored values name. A `user` or `entity` field holds an
 * id, and the hero must draw a name, so the read resolves them the way
 * the contract and Request reads do. */
const MatterRecordEnvelope = MatterEnvelope.extend({
  fields: z.array(AttachedCustomFieldSchema),
  customFieldRefs: StaffRequestCustomFieldRefsSchema,
  team: z.array(PersonSchema.extend({ role: z.enum(MATTER_TEAM_ROLES) })),
});
const MatterTeamEnvelope = z.object({
  team: z.array(PersonSchema.extend({ role: z.enum(MATTER_TEAM_ROLES) })),
});

interface MatterContext {
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

function toRow(context: MatterContext) {
  const { row } = context;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    matterTypeId: row.matterTypeId,
    matterTypeName: context.matterTypeName,
    statusId: row.statusId,
    statusName: context.statusName,
    statusCategory: context.statusCategory,
    manager: context.manager
      ? {
          id: context.manager.id,
          displayName: context.manager.displayName,
          image: context.manager.image,
          archived: context.manager.archivedAt !== null,
        }
      : null,
    priority: row.priority,
    risk: row.risk,
    customFields: row.customFields,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    isConfidential: row.isConfidential,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const mattersRoutes: FastifyPluginAsyncZod = async (app) => {
  const selectMatters = (db: Executor) =>
    db
      .select({
        row: matters,
        matterTypeName: matterTypes.displayName,
        statusName: matterStatuses.displayName,
        statusCategory: matterStatuses.category,
        manager: {
          id: users.id,
          displayName: users.displayName,
          image: users.image,
          archivedAt: users.archivedAt,
        },
      })
      .from(matters)
      .innerJoin(matterTypes, eq(matters.matterTypeId, matterTypes.id))
      .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
      .leftJoin(users, eq(matters.managerId, users.id));

  const selectTeam = async (db: Executor, matterId: string) => {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
        role: matterTeam.role,
      })
      .from(matterTeam)
      .innerJoin(users, eq(matterTeam.userId, users.id))
      .where(eq(matterTeam.matterId, matterId))
      .orderBy(asc(sql`lower(${users.displayName})`), asc(matterTeam.role));
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      image: row.image,
      archived: row.archivedAt !== null,
      role: row.role,
    }));
  };

  async function lockedMatter(
    tx: Transaction,
    number: number,
    user: AuthenticatedUser,
  ): Promise<MatterContext> {
    const row = await reachedMatter(tx, user, number, { lock: true });
    if (!row) throw httpError(404, NO_MATTER);
    const [context] = await selectMatters(tx).where(eq(matters.id, row.id)).limit(1);
    if (!context) throw httpError(404, NO_MATTER);
    return context;
  }

  function assertEditable(context: MatterContext): void {
    if (context.row.archivedAt) {
      throw httpError(409, "This matter is archived. Restore it before editing.");
    }
  }

  async function assertAudienceActor(
    tx: Transaction,
    current: MatterContext,
    user: AuthenticatedUser,
    refusal: string,
  ): Promise<void> {
    const verdict = await matterConfidentialityWrite(tx, user, current.row);
    if (verdict === "unreachable") throw httpError(404, NO_MATTER);
    if (verdict === "refused") throw httpError(403, refusal);
  }

  async function lockedLiveUser(tx: Transaction, userId: string, managerOnly = false) {
    const [person] = await tx
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!person || person.archivedAt || (managerOnly && !MATTER_MANAGER_ROLES.has(person.role))) {
      throw httpError(
        400,
        managerOnly ? MATTER_MANAGER_REFUSAL : "That is not a person we can add.",
      );
    }
    return person;
  }

  const scope = (user: AuthenticatedUser) => matterTeamScope(app.db, user);
  const SORTS: Record<MatterSortKey, { expr: SQL; joined: boolean }> = {
    number: { expr: sql`${matters.number}`, joined: false },
    title: { expr: sql`lower(${matters.title})`, joined: false },
    type: { expr: sql`lower(${matterTypes.displayName})`, joined: true },
    status: { expr: sql`${matterStatuses.displayOrder}`, joined: true },
    priority: { expr: severityRank(matters.priority), joined: false },
    risk: { expr: severityRank(matters.risk), joined: false },
    manager: { expr: sql`lower(${users.displayName})`, joined: true },
    openedAt: { expr: sql`${matters.openedAt}`, joined: false },
  };

  function listOrder(sort: SortRequest | null): SQL[] {
    if (!sort) return [sql`${matters.number} desc`];
    const { expr } = SORTS[sort.key];
    return [
      sql`${expr} ${sql.raw(sort.dir === "asc" ? "asc" : "desc")} nulls last`,
      sql`${matters.number} desc`,
    ];
  }

  function furtherDownThan(cursor: string, user: AuthenticatedUser, sort: SortRequest | null): SQL {
    const reach = scope(user);
    const at = sql`(
      select ${matters.number} from ${matters}
      where ${and(eq(matters.id, cursor), reach)}
    )`;
    if (!sort) return sql`${matters.number} < ${at}`;
    const { expr, joined } = SORTS[sort.key];
    const value = joined
      ? sql`(
          select ${expr} from ${matters}
            inner join ${matterTypes} on ${eq(matters.matterTypeId, matterTypes.id)}
            inner join ${matterStatuses} on ${eq(matters.statusId, matterStatuses.id)}
            left join ${users} on ${eq(matters.managerId, users.id)}
          where ${and(eq(matters.id, cursor), reach)}
          limit 1
        )`
      : sql`(
          select ${expr} from ${matters}
          where ${and(eq(matters.id, cursor), reach)}
        )`;
    const later = sql.raw(sort.dir === "asc" ? ">" : "<");
    return sql`case
      when ${value} is null
        then (${expr} is null and ${matters.number} < ${at})
      else (
        ${expr} is null
        or ${expr} ${later} ${value}
        or (${expr} = ${value} and ${matters.number} < ${at})
      )
    end`;
  }

  const incomplete = sql`exists (
    select 1 from ${matterTypeFields}
    inner join ${fields} on ${fields.id} = ${matterTypeFields.fieldId}
    where ${matterTypeFields.typeId} = ${matters.matterTypeId}
      and ${matterTypeFields.isRequired} = true
      and ${fields.archivedAt} is null
      and (
        not jsonb_exists(${matters.customFields}, ${fields.slug})
        or ${matters.customFields} -> ${fields.slug} = 'null'::jsonb
        or ${matters.customFields} -> ${fields.slug} = '[]'::jsonb
        or ${matters.customFields} ->> ${fields.slug} = ''
      )
  )`;

  app.get(
    "/matters",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatters",
        summary:
          "The managed Matters list, filtered and keyset-paged after access scope, with active counts",
        tags: ["matters"],
        querystring: z.object({
          includeClosed: z.enum(["true", "false"]).optional(),
          includeArchived: z.enum(["true", "false"]).optional(),
          status: z.string().min(1).max(64).optional(),
          type: z.string().min(1).max(64).optional(),
          priority: SeveritySchema.optional(),
          manager: z.string().min(1).max(64).optional(),
          incomplete: z.enum(["true", "false"]).optional(),
          sort: z.enum(MATTER_SORT_KEYS).optional(),
          dir: z.enum(SORT_DIRECTIONS).optional(),
          cursor: CursorSchema.optional(),
        }),
        response: {
          200: z.object({
            matters: z.array(MatterRowSchema),
            nextCursor: z.string().nullable(),
            counts: z.object({ open: z.number().int(), onHold: z.number().int() }),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const sort: SortRequest | null = request.query.sort
        ? { key: request.query.sort, dir: request.query.dir ?? "asc" }
        : null;
      const rows = await selectMatters(app.db)
        .where(
          and(
            request.query.includeArchived === "true" ? undefined : isNull(matters.archivedAt),
            request.query.includeClosed === "true"
              ? undefined
              : eq(matterStatuses.category, "open"),
            request.query.status ? eq(matters.statusId, request.query.status) : undefined,
            request.query.type ? eq(matters.matterTypeId, request.query.type) : undefined,
            request.query.priority ? eq(matters.priority, request.query.priority) : undefined,
            request.query.manager
              ? eq(
                  matters.managerId,
                  request.query.manager === "me" ? request.user.id : request.query.manager,
                )
              : undefined,
            request.query.incomplete === "true" ? incomplete : undefined,
            scope(request.user),
            request.query.cursor
              ? furtherDownThan(request.query.cursor, request.user, sort)
              : undefined,
          ),
        )
        .orderBy(...listOrder(sort))
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      const [counts] = await app.db
        .select({
          open: sql<number>`count(*) filter (where ${matterStatuses.slug} = 'open')::int`,
          onHold: sql<number>`count(*) filter (where ${matterStatuses.slug} = 'on_hold')::int`,
        })
        .from(matters)
        .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
        .where(and(isNull(matters.archivedAt), scope(request.user)));
      return {
        matters: page.map(toRow),
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.row.id ?? null) : null,
        counts: counts ?? { open: 0, onHold: 0 },
      };
    },
  );

  app.get(
    "/matters/options",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterOptions",
        summary: "Live matter types with attached fields, statuses, and assignable people",
        tags: ["matters"],
        response: {
          200: z.object({
            matterTypes: z.array(
              z.object({
                id: z.string(),
                slug: z.string(),
                displayName: z.string(),
                fields: z.array(AttachedCustomFieldSchema),
              }),
            ),
            matterStatuses: z.array(
              z.object({
                id: z.string(),
                slug: z.string(),
                displayName: z.string(),
                category: z.enum(["open", "closed"]),
              }),
            ),
            users: z.array(PersonSchema.extend({ role: z.enum(USER_ROLES) })),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const [types, statuses, people] = await Promise.all([
        app.db
          .select({
            id: matterTypes.id,
            slug: matterTypes.slug,
            displayName: matterTypes.displayName,
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
          })
          .from(matterStatuses)
          .where(isNull(matterStatuses.archivedAt))
          .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.createdAt)),
        app.db
          .select({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
            role: users.role,
          })
          .from(users)
          .where(isNull(users.archivedAt))
          .orderBy(asc(sql`lower(${users.displayName})`)),
      ]);
      const attached = await Promise.all(
        types.map((type) => selectAttachedFields(app.db, matterTypeFields, type.id)),
      );
      return {
        matterTypes: types.map((type, index) => ({ ...type, fields: attached[index]! })),
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
    async (request) => {
      // Archiving hides a matter from the collection; it does not revoke
      // an existing M-number link, so this lookup intentionally has no archive filter.
      const [context] = await selectMatters(app.db)
        .where(
          and(eq(matters.number, request.params.number), matterTeamScope(app.db, request.user)),
        )
        .limit(1);
      if (!context) throw httpError(404, NO_MATTER);
      const fields = await selectAttachedFields(app.db, matterTypeFields, context.row.matterTypeId);
      const customFieldRefs = await resolveStaffRefs(app.db, fields, context.row.customFields);
      return {
        matter: toRow(context),
        fields,
        customFieldRefs,
        team: await selectTeam(app.db, context.row.id),
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
          "Create the next M-number on the first live open status, enforcing required type fields",
        tags: ["matters"],
        body: z.strictObject({
          title: z.string().trim().min(1).max(MAX_MATTER_TITLE_LENGTH),
          matterTypeId: z.string(),
          managerId: z.string().nullable().optional(),
          priority: SeveritySchema.optional(),
          risk: SeveritySchema.nullable().optional(),
          description: z.string().trim().max(10_000).nullable().optional(),
          customFields: CustomFieldsInput.optional(),
          isConfidential: z.boolean().optional(),
        }),
        response: { 201: MatterEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const created = await app.db.transaction((tx) =>
        createMatter(tx, { ...request.body, actorId: request.user.id }),
      );
      return reply.status(201).send({ matter: toRow(created) });
    },
  );

  app.patch(
    "/matters/:number",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateMatter",
        summary:
          "Commit matter fields individually, including re-type gaps, unrestricted live status transitions, and confidentiality",
        tags: ["matters"],
        params: NumberParams,
        body: z.strictObject({
          title: z.string().trim().min(1).max(MAX_MATTER_TITLE_LENGTH).optional(),
          description: z.string().trim().max(10_000).nullable().optional(),
          matterTypeId: z.string().optional(),
          managerId: z.string().nullable().optional(),
          priority: SeveritySchema.optional(),
          risk: SeveritySchema.nullable().optional(),
          customFields: CustomFieldsInput.optional(),
          statusId: z.string().optional(),
          isConfidential: z.boolean().optional(),
        }),
        response: { 200: MatterRecordEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const body = request.body;
      const updated = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        if (body.isConfidential !== undefined) {
          await assertAudienceActor(
            tx,
            current,
            request.user,
            "Only an Administrator, the matter's creator, or its Matter Manager can change this.",
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
        const retyped =
          body.matterTypeId !== undefined && body.matterTypeId !== target.matterTypeId;
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
            patch.closedAt = new Date();
          } else if (current.statusCategory === "closed" && status.category === "open") {
            patch.closedAt = null;
          }
        }

        let confidentialityChange: boolean | undefined;
        if (body.isConfidential !== undefined && body.isConfidential !== target.isConfidential) {
          patch.isConfidential = body.isConfidential;
          confidentialityChange = body.isConfidential;
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
            actorId: request.user.id,
            action: "matter.updated",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: row.number, title: row.title, changed },
          });
        }
        if (retyped) {
          await recordActivity(tx, {
            entityType: "matter",
            entityId: target.id,
            actorId: request.user.id,
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
            actorId: request.user.id,
            action: "matter.status_changed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: row.number, title: row.title, ...statusChange },
          });
        }
        if (confidentialityChange !== undefined) {
          await recordActivity(tx, {
            entityType: "matter",
            entityId: target.id,
            actorId: request.user.id,
            action: confidentialityChange
              ? "matter.confidentiality_set"
              : "matter.confidentiality_cleared",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: row.number, title: row.title },
          });
        }
        return { row, matterTypeName, statusName, statusCategory, manager, attached };
      });
      return {
        matter: toRow(updated),
        fields: updated.attached,
        customFieldRefs: await resolveStaffRefs(app.db, updated.attached, updated.row.customFields),
        team: await selectTeam(app.db, updated.row.id),
      };
    },
  );

  app.post(
    "/matters/:number/team",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addMatterTeamMember",
        summary: "Add one person and role to a matter team",
        tags: ["matters"],
        params: NumberParams,
        body: z.strictObject({ userId: z.string(), role: z.enum(MATTER_TEAM_ROLES) }),
        response: { 201: MatterTeamEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        if (current.row.isConfidential) {
          await assertAudienceActor(
            tx,
            current,
            request.user,
            "Only an Administrator, the matter's creator, or its Matter Manager can change the team on a confidential matter.",
          );
        }
        assertEditable(current);
        if (request.body.role === MATTER_CREATOR_ROLE) {
          throw httpError(400, "The creator is recorded when the matter is created.");
        }
        const person = await lockedLiveUser(tx, request.body.userId);
        const inserted = await tx
          .insert(matterTeam)
          .values({ matterId: current.row.id, userId: person.id, role: request.body.role })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) throw httpError(409, "This person already holds that role.");
        await recordActivity(tx, {
          entityType: "matter",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "matter.team_added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: current.row.number,
            title: current.row.title,
            member: person.displayName,
            role: request.body.role,
          },
        });
        return selectTeam(tx, current.row.id);
      });
      return reply.status(201).send({ team });
    },
  );

  app.delete(
    "/matters/:number/team/:userId/:role",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeMatterTeamMember",
        summary: "Remove one compound-key role from a matter team, except creator",
        tags: ["matters"],
        params: NumberParams.extend({ userId: z.string(), role: z.enum(MATTER_TEAM_ROLES) }),
        response: { 200: MatterTeamEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedMatter(tx, request.params.number, request.user);
        if (current.row.isConfidential) {
          await assertAudienceActor(
            tx,
            current,
            request.user,
            "Only an Administrator, the matter's creator, or its Matter Manager can change the team on a confidential matter.",
          );
        }
        assertEditable(current);
        if (request.params.role === MATTER_CREATOR_ROLE) {
          throw httpError(409, "The creator stays on the record — it is who made it.");
        }
        const [removed] = await tx
          .delete(matterTeam)
          .where(
            and(
              eq(matterTeam.matterId, current.row.id),
              eq(matterTeam.userId, request.params.userId),
              eq(matterTeam.role, request.params.role),
            ),
          )
          .returning();
        if (!removed) throw httpError(404, "Nobody holds that role on this matter.");
        const [person] = await tx
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, request.params.userId))
          .limit(1);
        await recordActivity(tx, {
          entityType: "matter",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "matter.team_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: current.row.number,
            title: current.row.title,
            member: person?.displayName ?? request.params.userId,
            role: request.params.role,
          },
        });
        return selectTeam(tx, current.row.id);
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
      return { matter: toRow(archived) };
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
      return { matter: toRow(restored) };
    },
  );
};
