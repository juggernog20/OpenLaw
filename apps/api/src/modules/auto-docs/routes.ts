// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001–004: Legal maintains Auto-Docs and their two version chains. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { uuidv7 } from "uuidv7";
import {
  AUTO_DOC_FIELD_TYPES,
  VALUE_CADENCES,
  AUTO_DOC_AUDIENCES,
  AUTO_DOC_FORMATS,
  AUTO_DOC_CONTRACT_ATTRIBUTES,
  contractTypes,
  entities,
  fields as catalogFields,
  and,
  inArray,
  isNull,
  ne,
  AUTO_DOC_STATES,
  autoDocFormVersions,
  autoDocs,
  autoDocTemplateScans,
  asc,
  desc,
  documents,
  documentVersions,
  eq,
  sql,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import {
  insertDocumentVersion,
  nextVersionNumber,
  requestDerivations,
  versionStorageKey,
} from "../../lib/document-versions.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  asUploadRefusal,
  refuseOversize,
  uploadFilename,
  withStoredBlobs,
} from "../../lib/uploads.js";
import {
  appendForm,
  applyTemplateVersion,
  detectTemplateUpload,
  FormSaveInput,
  ClauseRuleInput,
  validateMaps,
  publicationGaps,
  latestForm,
} from "./forms.js";

import { entityReachScope } from "../../lib/entity-access.js";
import { contractPublicationGaps } from "./contract-destination.js";
import { escapeLikePattern } from "../../lib/like.js";
import { diffForms, FormChange } from "./form-diff.js";
import type { ChangedFields } from "@openlaw/shared";

const requireMember = requireRole("administrator", "legal_team_member");
const Params = z.object({ id: z.string() });
const AutoDocRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  formats: z.enum(AUTO_DOC_FORMATS),
  coverNote: z.string().nullable(),
  state: z.enum(AUTO_DOC_STATES),
  templateDocumentId: z.string().nullable(),
  audience: z.enum(AUTO_DOC_AUDIENCES),
  targetContractTypeId: z.string().nullable(),
  titlePattern: z.string().nullable(),
  fixedEntityId: z.string().nullable(),
  publishedDocumentVersionId: z.string().nullable(),
  publishedFormVersionId: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const AutoDocFieldRow = z.object({
  slug: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  fieldType: z.enum(AUTO_DOC_FIELD_TYPES),
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  displayOrder: z.number().int(),
  placeholder: z.boolean(),
  catalogFieldId: z.string().nullable(),
  contractAttribute: z.enum(AUTO_DOC_CONTRACT_ATTRIBUTES).nullable(),
  valueCurrency: z.string().nullable().optional(),
  valueCadence: z.enum(VALUE_CADENCES).nullable().optional(),
});
const FormVersion = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  definition: z.object({ fields: z.array(AutoDocFieldRow), clauseRules: z.array(ClauseRuleInput) }),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
const Detection = z.object({ placeholders: z.array(z.string()), blocks: z.array(z.string()) });
const Template = z.object({
  id: z.string(),
  title: z.string(),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number().int(),
      originalFilename: z.string(),
      byteSize: z.number(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
const RecordEnvelope = z.object({
  autoDoc: AutoDocRow,
  template: Template.nullable(),
  detection: Detection,
  formVersion: FormVersion.nullable(),
  formVersions: z.array(FormVersion),
  orphanedFields: z.array(z.string()),
});
const UploadBody = z.any().meta({
  type: "object",
  properties: { file: { type: "string", format: "binary" } },
  required: ["file"],
});
const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function readAutoDoc(db: Executor, id: string, lock = false) {
  const query = db.select().from(autoDocs).where(eq(autoDocs.id, id));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw httpError(404, "No Auto-Doc exists with this id.");
  return row;
}
function rowView(row: Awaited<ReturnType<typeof readAutoDoc>>) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
async function recordView(db: Executor, id: string) {
  const row = await readAutoDoc(db, id);
  const forms = await db
    .select()
    .from(autoDocFormVersions)
    .where(eq(autoDocFormVersions.autoDocId, id))
    .orderBy(desc(autoDocFormVersions.versionNumber));
  const formVersions = forms.map((form) => ({
    ...form,
    definition: {
      fields: form.definition.fields.map((field) => ({
        ...field,
        catalogFieldId: field.catalogFieldId ?? null,
        contractAttribute: field.contractAttribute ?? null,
      })),
      clauseRules: form.definition.clauseRules ?? [],
    },
    createdAt: form.createdAt.toISOString(),
  }));
  const formVersion = formVersions[0] ?? null;
  const [document] = row.templateDocumentId
    ? await db.select().from(documents).where(eq(documents.id, row.templateDocumentId))
    : [];
  const versions = document
    ? await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, document.id))
        .orderBy(desc(documentVersions.versionNumber))
    : [];
  const [scan] = versions[0]
    ? await db
        .select()
        .from(autoDocTemplateScans)
        .where(eq(autoDocTemplateScans.documentVersionId, versions[0].id))
    : [];
  const detection = scan?.detection ?? { placeholders: [], blocks: [] };
  return {
    autoDoc: rowView(row),
    template: document
      ? {
          id: document.id,
          title: document.title,
          versions: versions.map((version) => ({
            ...version,
            createdAt: version.createdAt.toISOString(),
          })),
        }
      : null,
    detection,
    formVersion,
    formVersions,
    orphanedFields: (formVersion?.definition.fields ?? [])
      .filter((field) => field.placeholder && !detection.placeholders.includes(field.slug))
      .map((field) => field.slug),
  };
}
async function editable(tx: Transaction, id: string) {
  const row = await readAutoDoc(tx, id, true);
  if (row.archivedAt || row.state === "archived")
    throw httpError(409, "Restore this Auto-Doc before editing it.");
  return row;
}

export const autoDocsRoutes: FastifyPluginAsyncZod = async (app) => {
  const snapshot = (id: string) =>
    app.db.transaction((tx) => recordView(tx, id), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });

  app.get(
    "/auto-docs/options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getAutoDocOptions",
        tags: ["auto-docs"],
        response: {
          200: z.object({
            catalogFields: z.array(
              z.object({ id: z.string(), displayName: z.string(), fieldType: z.string() }),
            ),
            contractTypes: z.array(z.object({ id: z.string(), displayName: z.string() })),
            entities: z.array(z.object({ id: z.string(), name: z.string() })),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [fields, types] = await Promise.all([
        app.db
          .select({
            id: catalogFields.id,
            displayName: catalogFields.displayName,
            fieldType: catalogFields.fieldType,
          })
          .from(catalogFields)
          .where(
            and(
              isNull(catalogFields.archivedAt),
              inArray(catalogFields.moduleScope, ["contract", "global"]),
            ),
          )
          .orderBy(asc(catalogFields.displayName)),
        app.db
          .select({ id: contractTypes.id, displayName: contractTypes.displayName })
          .from(contractTypes)
          .where(isNull(contractTypes.archivedAt))
          .orderBy(asc(contractTypes.displayName)),
      ]);
      const choices = await app.db
        .select({ id: entities.id, name: entities.legalName })
        .from(entities)
        .where(and(isNull(entities.archivedAt), entityReachScope(app.db, request.user)))
        .orderBy(asc(entities.legalName));
      return { catalogFields: fields, contractTypes: types, entities: choices };
    },
  );

  app.patch(
    "/auto-docs/:id",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateAutoDoc",
        summary: "Member+ edits Auto-Doc settings",
        tags: ["auto-docs"],
        params: Params,
        body: z.strictObject({
          name: z.string().trim().min(1).max(200).optional(),
          description: z.string().trim().max(4000).nullable().optional(),
          audience: z.enum(AUTO_DOC_AUDIENCES).optional(),
          formats: z.enum(AUTO_DOC_FORMATS).optional(),
          coverNote: z.string().trim().max(10_000).nullable().optional(),
          targetContractTypeId: z.string().min(1).nullable().optional(),
          titlePattern: z.string().trim().max(2000).nullable().optional(),
          fixedEntityId: z.string().min(1).nullable().optional(),
        }),
        response: { 200: RecordEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const row = await editable(tx, request.params.id);
        // Creation stores a blank description as null; an edit reads the
        // same way, so the two routes cannot leave "" beside null.
        const patch = {
          ...request.body,
          ...(request.body.titlePattern === undefined
            ? {}
            : { titlePattern: request.body.titlePattern || null }),
          ...(request.body.coverNote === undefined
            ? {}
            : { coverNote: request.body.coverNote || null }),
          ...(request.body.description === undefined
            ? {}
            : { description: request.body.description || null }),
        };
        if (patch.targetContractTypeId && patch.targetContractTypeId !== row.targetContractTypeId) {
          const [type] = await tx
            .select()
            .from(contractTypes)
            .where(
              and(
                eq(contractTypes.id, patch.targetContractTypeId),
                isNull(contractTypes.archivedAt),
              ),
            )
            .for("share");
          if (!type) throw httpError(400, "Choose a live Contract Type as the target.");
        }
        if (patch.fixedEntityId && patch.fixedEntityId !== row.fixedEntityId) {
          const [entity] = await tx
            .select({ id: entities.id })
            .from(entities)
            .where(
              and(
                eq(entities.id, patch.fixedEntityId),
                isNull(entities.archivedAt),
                entityReachScope(tx, request.user),
              ),
            )
            .for("share");
          if (!entity) throw httpError(400, "Choose a live Entity you can access.");
        }
        const changed: ChangedFields = {};
        for (const key of [
          "name",
          "description",
          "audience",
          "targetContractTypeId",
          "titlePattern",
          "fixedEntityId",
          "formats",
          "coverNote",
        ] as const) {
          const value = patch[key];
          if (value !== undefined && value !== row[key])
            changed[key] = { from: row[key], to: value };
        }
        if (changed.targetContractTypeId) {
          const ids = [row.targetContractTypeId, patch.targetContractTypeId].filter(
            (id): id is string => Boolean(id),
          );
          const names = ids.length
            ? await tx
                .select({ id: contractTypes.id, name: contractTypes.displayName })
                .from(contractTypes)
                .where(inArray(contractTypes.id, ids))
                .for("share")
            : [];
          const nameFor = (id: string | null | undefined) =>
            id ? (names.find((type) => type.id === id)?.name ?? id) : null;
          changed.targetContractType = {
            from: nameFor(row.targetContractTypeId),
            to: nameFor(patch.targetContractTypeId),
          };
          delete changed.targetContractTypeId;
        }
        if (changed.fixedEntityId) {
          const ids = [row.fixedEntityId, patch.fixedEntityId].filter((id): id is string =>
            Boolean(id),
          );
          const names = ids.length
            ? await tx
                .select({ id: entities.id, name: entities.legalName })
                .from(entities)
                .where(inArray(entities.id, ids))
            : [];
          const name = (id: string | null | undefined) =>
            id ? (names.find((entity) => entity.id === id)?.name ?? id) : null;
          changed.fixedEntity = { from: name(row.fixedEntityId), to: name(patch.fixedEntityId) };
          delete changed.fixedEntityId;
        }
        if (!Object.keys(changed).length) return;
        await tx
          .update(autoDocs)
          .set({ ...patch, updatedBy: request.user.id, updatedAt: new Date() })
          .where(eq(autoDocs.id, row.id));
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: row.id,
          actorId: request.user.id,
          action: "auto_doc.updated",
          visibility: "legal_only",
          payload: { name: patch.name ?? row.name, changed },
        });
      });
      return snapshot(request.params.id);
    },
  );

  app.get(
    "/auto-docs/:id/form-versions/diff",
    {
      preHandler: requireMember,
      schema: {
        operationId: "diffAutoDocForms",
        summary: "Compare two saved forms by structure",
        tags: ["auto-docs"],
        params: Params,
        querystring: z.object({ from: z.string().min(1), to: z.string().min(1) }),
        response: { 200: z.object({ changes: z.array(FormChange) }), default: problemResponse },
      },
    },
    async (request) => {
      await readAutoDoc(app.db, request.params.id);
      const versions = await app.db
        .select()
        .from(autoDocFormVersions)
        .where(
          and(
            eq(autoDocFormVersions.autoDocId, request.params.id),
            inArray(autoDocFormVersions.id, [request.query.from, request.query.to]),
          ),
        );
      const from = versions.find((version) => version.id === request.query.from);
      const to = versions.find((version) => version.id === request.query.to);
      if (!from || !to) throw httpError(404, "Choose two form versions from this Auto-Doc.");
      return { changes: diffForms(from.definition, to.definition) };
    },
  );

  app.post(
    "/auto-docs/:id/publish",
    {
      preHandler: requireMember,
      schema: {
        operationId: "publishAutoDoc",
        summary: "Validate and publish one file and form pair",
        tags: ["auto-docs"],
        params: Params,
        body: z.strictObject({
          documentVersionId: z.string().min(1),
          formVersionId: z.string().min(1),
        }),
        response: { 200: RecordEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const row = await editable(tx, request.params.id);
        const { documentVersionId, formVersionId } = request.body;
        if (
          row.state === "published" &&
          row.publishedDocumentVersionId === documentVersionId &&
          row.publishedFormVersionId === formVersionId
        )
          throw httpError(
            409,
            "This file and form pair is already published. Choose a new pair or Unpublish first.",
          );
        const [file] = row.templateDocumentId
          ? await tx
              .select()
              .from(documentVersions)
              .where(
                and(
                  eq(documentVersions.id, documentVersionId),
                  eq(documentVersions.documentId, row.templateDocumentId),
                ),
              )
              .for("share")
          : [];
        const [form] = await tx
          .select()
          .from(autoDocFormVersions)
          .where(
            and(
              eq(autoDocFormVersions.id, formVersionId),
              eq(autoDocFormVersions.autoDocId, row.id),
            ),
          )
          .for("share");
        if (!file || !form)
          throw httpError(400, "Choose a file version and a form version from this Auto-Doc.");
        const [scan] = await tx
          .select()
          .from(autoDocTemplateScans)
          .where(eq(autoDocTemplateScans.documentVersionId, file.id));
        if (!scan)
          throw httpError(409, "Upload a detected Word template before publishing this Auto-Doc.");
        const gaps = [
          ...publicationGaps(form.definition, scan.detection),
          ...contractPublicationGaps(row, form.definition),
        ];
        if (gaps.length) throw httpError(409, `This pair cannot be published. ${gaps.join(" ")}`);
        await validateMaps(tx, form.definition);
        await tx
          .update(autoDocs)
          .set({
            state: "published",
            publishedDocumentVersionId: documentVersionId,
            publishedFormVersionId: formVersionId,
            publishedAt: new Date(),
            updatedBy: request.user.id,
            updatedAt: new Date(),
          })
          .where(eq(autoDocs.id, row.id));
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: row.id,
          actorId: request.user.id,
          action: "auto_doc.published",
          visibility: "legal_only",
          payload: { name: row.name, documentVersionId, formVersionId },
        });
      });
      return snapshot(request.params.id);
    },
  );

  for (const action of ["unpublish", "archive", "restore"] as const) {
    const activity = {
      unpublish: "auto_doc.unpublished",
      archive: "auto_doc.archived",
      restore: "auto_doc.restored",
    } as const;
    app.post(
      `/auto-docs/:id/${action}`,
      {
        preHandler: requireMember,
        schema: {
          operationId: `${action}AutoDoc`,
          summary: `Member+ ${action === "unpublish" ? "unpublishes" : `${action}s`} an Auto-Doc without deleting versions`,
          tags: ["auto-docs"],
          params: Params,
          body: z.strictObject({}),
          response: { 200: RecordEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        await app.db.transaction(async (tx) => {
          const row = await readAutoDoc(tx, request.params.id, true);
          if (action === "unpublish" && row.state !== "published")
            throw httpError(409, "Only a published Auto-Doc can be unpublished.");
          if (action === "archive" && row.state === "archived")
            throw httpError(409, "This Auto-Doc is already archived.");
          if (action === "restore" && row.state !== "archived")
            throw httpError(409, "Only an archived Auto-Doc can be restored.");
          await tx
            .update(autoDocs)
            .set({
              state: action === "archive" ? "archived" : "draft",
              publishedDocumentVersionId: null,
              publishedFormVersionId: null,
              publishedAt: null,
              archivedAt: action === "archive" ? new Date() : null,
              updatedBy: request.user.id,
              updatedAt: new Date(),
            })
            .where(eq(autoDocs.id, row.id));
          await recordActivity(tx, {
            entityType: "auto_doc",
            entityId: row.id,
            actorId: request.user.id,
            action: activity[action],
            visibility: "legal_only",
            payload: {
              name: row.name,
              documentVersionId: row.publishedDocumentVersionId,
              formVersionId: row.publishedFormVersionId,
            },
          });
        });
        return snapshot(request.params.id);
      },
    );
  }

  app.get(
    "/auto-docs",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listAutoDocs",
        summary: "Member+ searches and filters Auto-Docs; archived records are hidden by default",
        querystring: z.object({
          q: z.string().trim().max(200).optional(),
          state: z.enum([...AUTO_DOC_STATES, "all"]).optional(),
          audience: z.enum(AUTO_DOC_AUDIENCES).optional(),
          targetContractTypeId: z.string().min(1).optional(),
        }),
        tags: ["auto-docs"],
        response: { 200: z.object({ autoDocs: z.array(AutoDocRow) }), default: problemResponse },
      },
    },
    async (request) => ({
      autoDocs: (
        await app.db
          .select()
          .from(autoDocs)
          .where(
            and(
              request.query.state === "all"
                ? undefined
                : request.query.state
                  ? eq(autoDocs.state, request.query.state)
                  : ne(autoDocs.state, "archived"),
              request.query.audience ? eq(autoDocs.audience, request.query.audience) : undefined,
              request.query.targetContractTypeId
                ? request.query.targetContractTypeId === "none"
                  ? isNull(autoDocs.targetContractTypeId)
                  : eq(autoDocs.targetContractTypeId, request.query.targetContractTypeId)
                : undefined,
              request.query.q
                ? sql`${autoDocs.name} ilike ${`%${escapeLikePattern(request.query.q)}%`}`
                : undefined,
            ),
          )
          .orderBy(asc(sql`lower(${autoDocs.name})`), asc(autoDocs.id))
      ).map(rowView),
    }),
  );
  app.post(
    "/auto-docs",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createAutoDoc",
        summary: "Member+ creates a draft Auto-Doc",
        tags: ["auto-docs"],
        body: z.strictObject({
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(4000).nullable().optional(),
        }),
        response: { 201: z.object({ autoDoc: AutoDocRow }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const row = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(autoDocs)
          .values({
            name: request.body.name,
            description: request.body.description || null,
            createdBy: request.user.id,
            updatedBy: request.user.id,
          })
          .returning();
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: created!.id,
          actorId: request.user.id,
          action: "auto_doc.created",
          visibility: "legal_only",
          payload: { name: created!.name },
        });
        return created!;
      });
      return reply.status(201).send({ autoDoc: rowView(row) });
    },
  );
  app.get(
    "/auto-docs/:id",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getAutoDoc",
        summary: "Member+ reads an Auto-Doc and its file and form versions",
        tags: ["auto-docs"],
        params: Params,
        response: { 200: RecordEnvelope, default: problemResponse },
      },
    },
    async (request) => snapshot(request.params.id),
  );

  app.post(
    "/auto-docs/:id/template",
    {
      preHandler: requireMember,
      schema: {
        operationId: "uploadAutoDocTemplate",
        summary:
          "Member+ uploads a Word template; malformed markers are refused before a Version is written",
        tags: ["auto-docs"],
        consumes: ["multipart/form-data"],
        params: Params,
        body: UploadBody,
        response: { 201: RecordEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const before = await readAutoDoc(app.db, request.params.id);
      const part = await request.file().catch((error) => {
        throw asUploadRefusal(error, app.maxUploadBytes);
      });
      if (!part) throw httpError(400, "Attach a Word template to upload.");
      const filename = uploadFilename(part.filename);
      const bytes = await part.toBuffer().catch((error) => {
        throw asUploadRefusal(error, app.maxUploadBytes);
      });
      if (part.file.truncated || bytes.length > app.maxUploadBytes)
        throw refuseOversize(app.maxUploadBytes);
      const detection = detectTemplateUpload(bytes, filename);
      const versionId = uuidv7();
      const proposedDocumentId = before.templateDocumentId ?? uuidv7();
      const fileRef = await app.storage.put(
        versionStorageKey(proposedDocumentId, versionId),
        Readable.from([bytes]),
      );
      await withStoredBlobs(app.storage, request.log, [fileRef], () =>
        app.db.transaction(async (tx) => {
          const row = await editable(tx, request.params.id);
          // Another first upload may have established the chain while storage was writing.
          // File references are opaque; this locked row decides which Document owns the Version.
          const documentId = row.templateDocumentId ?? proposedDocumentId;
          if (!row.templateDocumentId)
            await tx.insert(documents).values({
              id: documentId,
              autoDocId: row.id,
              title: filename,
              createdBy: request.user.id,
            });
          const versionNumber = await nextVersionNumber(tx, documentId);
          await insertDocumentVersion(tx, {
            documentId,
            versionId,
            versionNumber,
            fileRef,
            kind: "general",
            source: "uploaded",
            comparedFromVersionId: null,
            comparedToVersionId: null,
            note: null,
            originalFilename: filename,
            mimeType: MIME,
            byteSize: bytes.length,
            checksumSha256: createHash("sha256").update(bytes).digest("hex"),
            createdBy: request.user.id,
          });
          await tx
            .update(documents)
            .set({ updatedAt: new Date() })
            .where(eq(documents.id, documentId));
          await applyTemplateVersion(tx, {
            autoDocId: row.id,
            name: row.name,
            actorId: request.user.id,
            documentId,
            versionId,
            versionNumber,
            detection,
          });
        }),
      );
      await requestDerivations(app.jobs, app.log, {
        versionId,
        mimeType: MIME,
        originalFilename: filename,
      });
      return reply.status(201).send(await snapshot(request.params.id));
    },
  );
  app.post(
    "/auto-docs/:id/form-versions",
    {
      preHandler: requireMember,
      schema: {
        operationId: "saveAutoDocForm",
        summary: "Member+ saves a new immutable form snapshot",
        tags: ["auto-docs"],
        params: Params,
        body: FormSaveInput,
        response: { 201: RecordEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const row = await editable(tx, request.params.id);
        const before = await latestForm(tx, row.id);
        const current = await recordView(tx, row.id);
        const fields = request.body.fields.map((field, displayOrder) => ({
          ...field,
          displayOrder,
          placeholder:
            current.detection.placeholders.includes(field.slug) ||
            before?.definition.fields.find((previous) => previous.slug === field.slug)
              ?.placeholder === true,
        }));
        const definition = { fields, clauseRules: request.body.clauseRules };
        const missingBlocks = definition.clauseRules.filter(
          (rule) => !current.detection.blocks.includes(rule.blockName),
        );
        if (missingBlocks.length)
          throw httpError(
            400,
            missingBlocks
              .map(
                (rule) =>
                  `Clause rule "${rule.blockName}" names a Block this template does not hold.`,
              )
              .join(" "),
          );
        await validateMaps(tx, definition);
        const version = await appendForm(tx, row.id, request.user.id, definition, before);
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: row.id,
          actorId: request.user.id,
          action: "auto_doc.form_saved",
          visibility: "legal_only",
          payload: {
            name: row.name,
            formVersionId: version.id,
            versionNumber: version.versionNumber,
          },
        });
      });
      return reply.status(201).send(await snapshot(request.params.id));
    },
  );
};
