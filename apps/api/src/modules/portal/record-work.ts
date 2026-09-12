// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  DOCUMENT_VERSION_KINDS,
  VALUE_CADENCES,
  SEVERITY_LEVELS,
  and,
  asc,
  contracts,
  contractTypeFields,
  desc,
  documents,
  documentVersions,
  entities,
  eq,
  inArray,
  isNull,
  lt,
  matters,
  matterTypeFields,
  or,
  requests,
  requestAttachments,
  requestTypeFields,
  sql,
  users,
  type CustomFieldValue,
  type Executor,
} from "@openlaw/db";
import { requireAuth, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  assertBusinessCustomFieldWrite,
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
  projectCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { renderFamilyOf, RENDER_FAMILIES } from "../../lib/render-family.js";

const ValueInput = z.strictObject({
  amount: z.int().nonnegative(),
  currency: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => new Set(Intl.supportedValuesOf("currency")).has(value)),
  cadence: z.enum(VALUE_CADENCES),
});
const Value = z.object({
  amount: z.int().nonnegative(),
  currency: z.string(),
  cadence: z.enum(VALUE_CADENCES),
});
const BusinessValues = {
  value: Value.nullable().optional(),
  effectiveDate: z.iso.date().nullable().optional(),
};
async function contractBusinessValues(db: Executor, id: string) {
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return {
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
  summary: z.string(),
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
const SupportingDocument = z.object({
  id: z.string(),
  title: z.string(),
  version: z.object({
    id: z.string(),
    versionNumber: z.number().int(),
    originalFilename: z.string(),
    mimeType: z.string(),
    byteSize: z.number(),
    renderFamily: z.enum(RENDER_FAMILIES),
    kind: z.enum(DOCUMENT_VERSION_KINDS),
  }),
});

/** Scope reference choices to attached Fields and keep withheld Entity names out of the response. */
async function references(
  db: Executor,
  fields: readonly z.infer<typeof AttachedCustomFieldSchema>[],
  values: Readonly<Record<string, CustomFieldValue>>,
  choices: boolean,
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
          .where(
            choices
              ? or(isNull(users.archivedAt), inArray(users.id, peopleIds))
              : inArray(users.id, peopleIds),
          )
          .orderBy(asc(users.displayName), asc(users.id))
      : [],
    fields.some((field) => field.fieldType === "entity")
      ? db
          .select({ id: entities.id, label: entities.legalName, archivedAt: entities.archivedAt })
          .from(entities)
          .where(
            and(
              eq(entities.isConfidential, false),
              choices
                ? or(isNull(entities.archivedAt), inArray(entities.id, entityIds))
                : inArray(entities.id, entityIds),
            ),
          )
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
    async function reached(db: Executor, user: AuthenticatedUser, number: number, lock = false) {
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
      const [row] = await (lock ? query.for("update") : query);
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
            references: await references(app.db, projection.fields, projection.customFields, true),
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
                    current: sql<boolean>`${documentVersions.versionNumber} = (select max(v.version_number) from document_versions v where v.document_id = ${documents.id})`,
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
                  summary: original.summary,
                  description: original.description,
                  urgency: original.urgency,
                  documents: paper.map((file) => ({
                    filename: file.filename,
                    reference:
                      file.onRecord &&
                      !file.archivedAt &&
                      file.documentId &&
                      file.versionId &&
                      (!file.primary || file.current)
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
                  references: await references(app.db, fields, original.customFields, false),
                };
              }),
            ),
          },
        };
      },
    );

    app.patch(
      `${prefix}/work`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: `updatePortal${name}Work`,
          tags: ["portal"],
          params: Params,
          body: z.strictObject({
            ...BusinessValues,
            value: ValueInput.nullable().optional(),
            description: z.string().max(50_000).nullable().optional(),
            customFields: CustomFieldsInput.optional(),
          }),
          response: {
            200: z.object({
              ...BusinessValues,
              description: z.string().nullable(),
              customFields: CustomFieldsSchema,
            }),
            default: problemResponse,
          },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        return app.db.transaction(async (tx) => {
          const row = await reached(tx, request.user, request.params.number, true);
          if (
            module === "matter" &&
            (request.body.value !== undefined || request.body.effectiveDate !== undefined)
          )
            throw httpError(400, "These Fields belong to a Contract.");
          const attached = await selectAttachedFields(tx, attachments, row.typeId);
          const incoming = request.body.customFields ?? {};
          assertBusinessCustomFieldWrite(attached, incoming);
          for (const field of attached.filter((field) => field.fieldType === "entity")) {
            const id = incoming[field.slug];
            if (typeof id !== "string" || id === row.customFields[field.slug]) continue;
            const [entity] = await tx
              .select({ id: entities.id })
              .from(entities)
              .where(
                and(
                  eq(entities.id, id),
                  eq(entities.isConfidential, false),
                  isNull(entities.archivedAt),
                ),
              )
              .limit(1)
              .for("share");
            if (!entity) throw httpError(400, "Choose an available Entity.");
          }
          const { values, changed } = await applyCustomFields(
            tx,
            attached,
            row.customFields,
            incoming,
          );
          assertRequiredCustomFields(
            attached.filter((field) => Object.hasOwn(incoming, field.slug)),
            values,
          );
          const description =
            request.body.description === undefined
              ? row.description
              : request.body.description?.trim() || null;
          if (description !== row.description)
            changed.description = { from: row.description, to: description };
          const businessValues: Partial<Awaited<ReturnType<typeof contractBusinessValues>>> =
            module === "contract" ? await contractBusinessValues(tx, row.id) : {};
          if (module === "contract") {
            const patch: Partial<typeof contracts.$inferInsert> = {};
            if (request.body.value !== undefined) {
              const value = request.body.value;
              if (JSON.stringify(value) !== JSON.stringify(businessValues.value))
                changed.value = { from: businessValues.value, to: value };
              patch.valueAmount = value?.amount ?? null;
              patch.valueCurrency = value?.currency ?? null;
              patch.valueCadence = value?.cadence ?? null;
              businessValues.value = value;
            }
            if (request.body.effectiveDate !== undefined) {
              if (businessValues.effectiveDate !== request.body.effectiveDate)
                changed.effectiveDate = {
                  from: businessValues.effectiveDate,
                  to: request.body.effectiveDate,
                };
              patch.effectiveDate = request.body.effectiveDate;
              businessValues.effectiveDate = request.body.effectiveDate;
            }
            if (Object.keys(patch).length)
              await tx.update(contracts).set(patch).where(eq(contracts.id, row.id));
          }
          const builtins = new Set([
            "title",
            "description",
            "priority",
            "contract_type",
            "matter_type",
            "counterparty",
            "needed_by",
            "term_type",
            "effective_date",
            "expiry_date",
            "renewal_period_months",
            "notice_period_days",
            "value",
          ]);
          const cleared = Object.keys(incoming).flatMap((slug) =>
            builtins.has(slug) ? [`field:${slug}`] : [slug, `field:${slug}`],
          );
          if (request.body.value !== undefined) cleared.push("value");
          if (request.body.effectiveDate !== undefined) cleared.push("effective_date");
          if (request.body.description !== undefined) cleared.push("description");
          if (module === "contract" && cleared.length) {
            const humanFields = [
              ...new Set(cleared.map((slug) => (slug.startsWith("field:") ? slug.slice(6) : slug))),
            ];
            await tx
              .update(contracts)
              .set({
                analysisHumanFields: sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements(${contracts.analysisHumanFields} || ${JSON.stringify(humanFields)}::jsonb))`,
              })
              .where(eq(contracts.id, row.id));
          }
          await tx
            .update(table)
            .set({
              description,
              customFields: values,
              aiUnverified: sql`nullif(${table.aiUnverified} - ${sql.param(cleared)}::text[], '{}'::jsonb)`,
              updatedAt: new Date(),
            })
            .where(eq(table.id, row.id));
          if (Object.keys(changed).length) {
            await recordActivity(tx, {
              entityType: module,
              entityId: row.id,
              actorId: request.user.id,
              action: module === "contract" ? "contract.updated" : "matter.updated",
              visibility: "full_thread",
              payload: {
                number: row.number,
                title: row.title,
                changed,
                ...(request.user.role === "business_user" ? { actorRole: request.user.role } : {}),
              },
            });
          }
          return {
            ...businessValues,
            description,
            customFields: projectCustomFields("business_user", attached, values).customFields,
          };
        });
      },
    );

    app.get(
      `${prefix}/supporting-documents`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: `listPortal${name}SupportingDocuments`,
          tags: ["portal"],
          params: Params,
          querystring: z.object({ cursor: z.string().optional() }),
          response: {
            200: z.object({
              documents: z.array(SupportingDocument),
              nextCursor: z.string().nullable(),
            }),
            default: problemResponse,
          },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const row = await reached(app.db, request.user, request.params.number);
        const scope = and(
          eq(module === "contract" ? documents.contractId : documents.matterId, row.id),
          isNull(documents.archivedAt),
          module === "contract"
            ? sql`not exists (select 1 from ${contracts} where ${contracts.id} = ${row.id} and ${contracts.primaryDocumentId} = ${documents.id})`
            : undefined,
        );
        if (request.query.cursor) {
          const [cursor] = await app.db
            .select({ id: documents.id })
            .from(documents)
            .where(and(scope, eq(documents.id, request.query.cursor)))
            .limit(1);
          if (!cursor) return { documents: [], nextCursor: null };
        }
        const rows = await app.db
          .select({ id: documents.id, title: documents.title, version: documentVersions })
          .from(documents)
          .innerJoin(
            documentVersions,
            and(
              eq(documentVersions.documentId, documents.id),
              sql`${documentVersions.versionNumber} = (select max(v.version_number) from document_versions v where v.document_id = ${documents.id})`,
            ),
          )
          .where(
            and(scope, request.query.cursor ? lt(documents.id, request.query.cursor) : undefined),
          )
          .orderBy(desc(documents.id))
          .limit(51);
        const page = rows.slice(0, 50);
        return {
          documents: page.map(({ id, title, version }) => ({
            id,
            title,
            version: {
              id: version.id,
              versionNumber: version.versionNumber,
              originalFilename: version.originalFilename,
              mimeType: version.mimeType,
              byteSize: version.byteSize,
              kind: version.kind,
              renderFamily: renderFamilyOf(version.mimeType, version.originalFilename),
            },
          })),
          nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
        };
      },
    );
  }
};
