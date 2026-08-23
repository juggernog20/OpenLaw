// SPDX-License-Identifier: AGPL-3.0-only

/** The first matter surface: list, create, options, and record read. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  matters,
  matterStatuses,
  matterTypeFields,
  matterTypes,
  SEVERITY_LEVELS,
  sql,
  users,
  USER_ROLES,
  type Executor,
  type Matter,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { matterTeamScope, NO_MATTER } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { resolveStaffRefs, StaffRequestCustomFieldRefsSchema } from "../requests/projection.js";
import { createMatter } from "./create.js";

const requireMember = requireRole("administrator", "legal_team_member");
const requireReader = requireRole("administrator", "legal_team_member", "contributor");
const SeveritySchema = z.enum(SEVERITY_LEVELS);
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

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

  app.get(
    "/matters",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatters",
        summary: "List the matters this reader reaches, newest M-number first",
        tags: ["matters"],
        response: {
          200: z.object({ matters: z.array(MatterRowSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await selectMatters(app.db)
        .where(and(isNull(matters.archivedAt), matterTeamScope(app.db, request.user)))
        .orderBy(desc(matters.number));
      return { matters: rows.map(toRow) };
    },
  );

  app.get(
    "/matters/options",
    {
      preHandler: requireMember,
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
      return { matter: toRow(context), fields, customFieldRefs };
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
          title: z.string().trim().min(1).max(500),
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
};
