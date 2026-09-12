// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  VALUE_CADENCES,
  SEVERITY_LEVELS,
  and,
  asc,
  contracts,
  contractTypeFields,
  documents,
  documentVersions,
  entities,
  eq,
  inArray,
  isNull,
  matters,
  matterTypeFields,
  requests,
  requestAttachments,
  requestTypeFields,
  sql,
  users,
  type CustomFieldValue,
  type Executor,
} from "@openlaw/db";
import { requireAuth, type AuthenticatedUser } from "../../auth/guards.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsSchema,
  projectCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Value = z.object({
  amount: z.int().nonnegative(),
  currency: z.string(),
  cadence: z.enum(VALUE_CADENCES),
});
const BusinessValues = {
  owningDepartment: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  value: Value.nullable().optional(),
  effectiveDate: z.iso.date().nullable().optional(),
};
async function contractBusinessValues(db: Executor, id: string) {
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return {
    owningDepartment: row!.owningDepartment,
    region: row!.region,
    effectiveDate: row!.effectiveDate,
    value:
      row!.valueAmount === null
        ? null
        : { amount: row!.valueAmount, currency: row!.valueCurrency!, cadence: row!.valueCadence! },
  };
}

const Params = z.object({ number: z.coerce.number().int().positive() });
const Reference = z.object({
  id: z.string(),
  label: z.string(),
  archived: z.boolean(),
  restricted: z.boolean().optional(),
});
const References = z.object({ people: z.array(Reference), entities: z.array(Reference) });
const OriginalRequest = z.object({
  number: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  requester: z.string(),
  urgency: z.enum(SEVERITY_LEVELS),
  documents: z.array(
    z.object({
      filename: z.string(),
      reference: z
        .object({ documentId: z.string(), versionId: z.string(), primary: z.boolean() })
        .nullable(),
    }),
  ),
  fields: z.array(AttachedCustomFieldSchema),
  customFields: CustomFieldsSchema,
  references: References,
});
const Work = z.object({
  ...BusinessValues,
  id: z.string(),
  description: z.string().nullable(),
  fields: z.array(AttachedCustomFieldSchema),
  customFields: CustomFieldsSchema,
  references: References,
  originalRequests: z.array(OriginalRequest),
});
/** Resolve names used by visible Fields, withholding Confidential Entity names. */
async function references(
  db: Executor,
  fields: readonly z.infer<typeof AttachedCustomFieldSchema>[],
  values: Readonly<Record<string, CustomFieldValue>>,
) {
  const ids = (type: "user" | "entity") =>
    fields
      .filter((field) => field.fieldType === type)
      .flatMap((field) =>
        typeof values[field.slug] === "string" ? [values[field.slug] as string] : [],
      );
  const peopleIds = ids("user");
  const entityIds = ids("entity");
  const [people, named] = await Promise.all([
    fields.some((field) => field.fieldType === "user")
      ? db
          .select({ id: users.id, label: users.displayName, archivedAt: users.archivedAt })
          .from(users)
          .where(inArray(users.id, peopleIds))
          .orderBy(asc(users.displayName), asc(users.id))
      : [],
    fields.some((field) => field.fieldType === "entity")
      ? db
          .select({ id: entities.id, label: entities.legalName, archivedAt: entities.archivedAt })
          .from(entities)
          .where(and(eq(entities.isConfidential, false), inArray(entities.id, entityIds)))
          .orderBy(asc(entities.legalName), asc(entities.id))
      : [],
  ]);
  return {
    people: people.map(({ archivedAt, ...person }) => ({
      ...person,
      archived: archivedAt !== null,
    })),
    entities: [
      ...named.map(({ archivedAt, ...entity }) => ({ ...entity, archived: archivedAt !== null })),
      ...entityIds
        .filter((id) => !named.some((row) => row.id === id))
        .map((id) => ({ id, label: "Restricted Entity", archived: false, restricted: true })),
    ],
  };
}

export const portalRecordWorkRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const module of ["contract", "matter"] as const) {
    const table = module === "contract" ? contracts : matters;
    const attachments = module === "contract" ? contractTypeFields : matterTypeFields;
    const typeId = module === "contract" ? contracts.contractTypeId : matters.matterTypeId;
    const prefix = `/portal/${module}s/:number`;
    const name = module === "contract" ? "Contract" : "Matter";
    async function reached(db: Executor, user: AuthenticatedUser, number: number) {
      const query = db
        .select({
          id: table.id,
          number: table.number,
          title: table.title,
          description: table.description,
          customFields: table.customFields,
          typeId,
        })
        .from(table)
        .where(and(eq(table.number, number), portalRecordScope(db, user, module)))
        .limit(1);
      const [row] = await query;
      if (!row) throw httpError(404, `No ${module} exists with this number.`);
      return row;
    }

    app.get(
      `${prefix}/work`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: `readPortal${name}Work`,
          tags: ["portal"],
          params: Params,
          response: { 200: z.object({ work: Work }), default: problemResponse },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const row = await reached(app.db, request.user, request.params.number);
        const attached = await selectAttachedFields(app.db, attachments, row.typeId);
        const projection = projectCustomFields("business_user", attached, row.customFields);
        const originals = await app.db
          .select({ row: requests, requester: users.displayName })
          .from(requests)
          .innerJoin(users, eq(users.id, requests.requesterId))
          .where(
            and(
              eq(
                module === "contract" ? requests.convertedContractId : requests.convertedMatterId,
                row.id,
              ),
              isNull(requests.archivedAt),
            ),
          )
          .orderBy(asc(requests.createdAt), asc(requests.id));
        return {
          work: {
            id: row.id,
            description: row.description,
            ...projection,
            ...(module === "contract" ? await contractBusinessValues(app.db, row.id) : {}),
            references: await references(app.db, projection.fields, projection.customFields),
            originalRequests: await Promise.all(
              originals.map(async ({ row: original, requester }) => {
                const fields = await selectAttachedFields(
                  app.db,
                  requestTypeFields,
                  original.requestTypeId,
                );
                const paper = await app.db
                  .select({
                    filename: requestAttachments.filename,
                    documentId: documents.id,
                    versionId: documentVersions.id,
                    archivedAt: documents.archivedAt,
                    onRecord:
                      module === "contract"
                        ? eq(documents.contractId, row.id)
                        : eq(documents.matterId, row.id),
                    primary:
                      module === "contract"
                        ? sql<boolean>`exists (select 1 from ${contracts} where ${contracts.id} = ${row.id} and ${contracts.primaryDocumentId} = ${documents.id})`
                        : sql<boolean>`false`,
                  })
                  .from(requestAttachments)
                  .leftJoin(
                    documentVersions,
                    eq(documentVersions.id, requestAttachments.promotedVersionId),
                  )
                  .leftJoin(documents, eq(documents.id, documentVersions.documentId))
                  .where(eq(requestAttachments.requestId, original.id))
                  .orderBy(asc(requestAttachments.createdAt), asc(requestAttachments.id));
                return {
                  number: original.number,
                  title: original.title,
                  description: original.description,
                  urgency: original.urgency,
                  documents: paper.map((file) => ({
                    filename: file.filename,
                    reference:
                      file.onRecord && !file.archivedAt && file.documentId && file.versionId
                        ? {
                            documentId: file.documentId,
                            versionId: file.versionId,
                            primary: file.primary,
                          }
                        : null,
                  })),
                  submittedAt: original.createdAt.toISOString(),
                  requester,
                  fields,
                  customFields: original.customFields,
                  references: await references(app.db, fields, original.customFields),
                };
              }),
            ),
          },
        };
      },
    );
  }
};
