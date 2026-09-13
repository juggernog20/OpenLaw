// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001–004: Legal maintains Auto-Docs and their two version chains. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { uuidv7 } from "uuidv7";
import {
  AUTO_DOC_FIELD_TYPES,
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
  latestForm,
} from "./forms.js";

const requireMember = requireRole("administrator", "legal_team_member");
const Params = z.object({ id: z.string() });
const AutoDocRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  state: z.enum(AUTO_DOC_STATES),
  templateDocumentId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const FieldRow = z.object({
  slug: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  fieldType: z.enum(AUTO_DOC_FIELD_TYPES),
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  displayOrder: z.number().int(),
  placeholder: z.boolean(),
});
const FormVersion = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  definition: z.object({ fields: z.array(FieldRow) }),
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
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function recordView(db: Executor, id: string) {
  const row = await readAutoDoc(db, id);
  const forms = await db
    .select()
    .from(autoDocFormVersions)
    .where(eq(autoDocFormVersions.autoDocId, id))
    .orderBy(desc(autoDocFormVersions.versionNumber));
  const formVersions = forms.map((form) => ({ ...form, createdAt: form.createdAt.toISOString() }));
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
    "/auto-docs",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listAutoDocs",
        summary: "Member+ lists Auto-Docs",
        tags: ["auto-docs"],
        response: { 200: z.object({ autoDocs: z.array(AutoDocRow) }), default: problemResponse },
      },
    },
    async () => ({
      autoDocs: (
        await app.db
          .select()
          .from(autoDocs)
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
        const version = await appendForm(tx, row.id, request.user.id, fields, before);
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
