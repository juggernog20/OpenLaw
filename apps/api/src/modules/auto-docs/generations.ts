// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-007: accept one live pair, then fill and store a Generation's own output. */
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import {
  AUTO_DOC_GENERATION_STATES,
  autoDocGenerations,
  autoDocFormVersions,
  autoDocs,
  documentVersions,
  users,
  entities,
  and,
  eq,
  desc,
  asc,
  isNull,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { AUTO_DOC_SLUG } from "../../lib/auto-doc-template.js";
import { AutoDocFillError } from "../../lib/auto-doc-fill/engine.js";
import { entityReachScope } from "../../lib/entity-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { attachmentDisposition, withStoredBlob } from "../../lib/uploads.js";
import { validateGenerationAnswers } from "./answers.js";
import { AutoDocFieldRow } from "./routes.js";

const requireMember = requireRole("administrator", "legal_team_member");
/** DOC-012: the Generation id groups its blobs; the fresh tail keeps a
 * written key from ever being written again, so a later retry mints a new
 * one rather than colliding with what a failed attempt left behind. */
function generationDocxKey(generationId: string): string {
  return `auto-doc-generations/${generationId}/${uuidv7()}.docx`;
}
const Params = z.object({ id: z.string() });
const GenerationParams = Params.extend({ generationId: z.string() });
const Pair = z.object({ documentVersionId: z.string().min(1), formVersionId: z.string().min(1) });
const Value = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(1000),
]);
const Answers = z.record(z.string().regex(AUTO_DOC_SLUG), Value);
const GenerationRow = z.object({
  id: z.string(),
  autoDocId: z.string(),
  autoDocName: z.string(),
  documentVersionId: z.string(),
  formVersionId: z.string(),
  documentVersionNumber: z.number().int(),
  formVersionNumber: z.number().int(),
  generatedBy: z.string(),
  person: z.object({ id: z.string(), displayName: z.string() }),
  answers: Answers,
  state: z.enum(AUTO_DOC_GENERATION_STATES),
  hasDocx: z.boolean(),
  failure: z.object({ code: z.string(), detail: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const Envelope = z.object({ generation: GenerationRow });

async function livePair(tx: Transaction, id: string, submitted?: z.infer<typeof Pair>) {
  const [autoDoc] = await tx.select().from(autoDocs).where(eq(autoDocs.id, id)).for("share");
  if (!autoDoc) throw httpError(404, "No Auto-Doc exists with this id.");
  if (autoDoc.state !== "published")
    throw httpError(
      409,
      `"${autoDoc.name}" is not published. Your answers have not been submitted.`,
    );
  if (
    submitted &&
    (submitted.documentVersionId !== autoDoc.publishedDocumentVersionId ||
      submitted.formVersionId !== autoDoc.publishedFormVersionId)
  )
    throw httpError(
      409,
      `The published form or template for "${autoDoc.name}" has changed. Review the current form before generating. Your answers have not been submitted.`,
    );
  const [file] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, autoDoc.publishedDocumentVersionId!))
    .for("share");
  const [form] = await tx
    .select()
    .from(autoDocFormVersions)
    .where(eq(autoDocFormVersions.id, autoDoc.publishedFormVersionId!))
    .for("share");
  if (!file || !form) throw httpError(409, "This Auto-Doc has no available published pair.");
  return { autoDoc, file, form, pair: { documentVersionId: file.id, formVersionId: form.id } };
}

function generationQuery(db: Executor) {
  return db
    .select({
      generation: autoDocGenerations,
      autoDocName: autoDocs.name,
      person: { id: users.id, displayName: users.displayName },
      documentVersionNumber: documentVersions.versionNumber,
      formVersionNumber: autoDocFormVersions.versionNumber,
    })
    .from(autoDocGenerations)
    .innerJoin(autoDocs, eq(autoDocs.id, autoDocGenerations.autoDocId))
    .innerJoin(users, eq(users.id, autoDocGenerations.generatedBy))
    .innerJoin(documentVersions, eq(documentVersions.id, autoDocGenerations.documentVersionId))
    .innerJoin(autoDocFormVersions, eq(autoDocFormVersions.id, autoDocGenerations.formVersionId));
}
function toGeneration(row: Awaited<ReturnType<typeof generationQuery>>[number]) {
  const { docxFileRef, ...generation } = row.generation;
  return {
    ...generation,
    autoDocName: row.autoDocName,
    person: row.person,
    documentVersionNumber: row.documentVersionNumber,
    formVersionNumber: row.formVersionNumber,
    hasDocx: docxFileRef !== null,
    createdAt: generation.createdAt.toISOString(),
    updatedAt: generation.updatedAt.toISOString(),
  };
}
async function readGeneration(db: Executor, id: string, generationId: string) {
  const [row] = await generationQuery(db).where(
    and(eq(autoDocGenerations.id, generationId), eq(autoDocGenerations.autoDocId, id)),
  );
  if (!row) throw httpError(404, "No Generation exists with this id on this Auto-Doc.");
  return row;
}

export const autoDocGenerationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/auto-docs/:id/generate",
    {
      preHandler: requireMember,
      schema: {
        tags: ["Auto-Docs"],
        summary: "Open the published form for Generation, Member+",
        params: Params,
        response: {
          200: z.object({
            autoDoc: z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().nullable(),
            }),
            pair: Pair,
            fields: z.array(AutoDocFieldRow),
            entities: z.array(z.object({ id: z.string(), name: z.string() })),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const { autoDoc, pair, form } = await livePair(tx, request.params.id);
        const options = form.definition.fields.some((field) => field.fieldType === "entity")
          ? await tx
              .select({ id: entities.id, name: entities.legalName })
              .from(entities)
              .where(and(isNull(entities.archivedAt), entityReachScope(tx, request.user)))
              .orderBy(asc(entities.legalName))
          : [];
        return {
          autoDoc: { id: autoDoc.id, name: autoDoc.name, description: autoDoc.description },
          pair,
          fields: form.definition.fields.map((field) => ({
            ...field,
            catalogFieldId: field.catalogFieldId ?? null,
            contractAttribute: field.contractAttribute ?? null,
          })),
          entities: options,
        };
      }),
  );

  app.post(
    "/auto-docs/:id/generations",
    {
      preHandler: requireMember,
      schema: {
        tags: ["Auto-Docs"],
        summary: "Generate a Word file from the submitted live pair, Member+",
        params: Params,
        body: Pair.extend({
          answers: z.record(z.string().regex(AUTO_DOC_SLUG), Value.nullable()),
        }).strict(),
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const accepted = await app.db.transaction(async (tx) => {
        const live = await livePair(tx, request.params.id, request.body);
        const { answers, displayValues } = await validateGenerationAnswers(
          tx,
          request.user,
          live.form.definition,
          request.body.answers,
        );
        const [generation] = await tx
          .insert(autoDocGenerations)
          .values({
            autoDocId: live.autoDoc.id,
            ...live.pair,
            generatedBy: request.user.id,
            answers,
          })
          .returning();
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: live.autoDoc.id,
          actorId: request.user.id,
          action: "auto_doc.generated",
          visibility: "legal_only",
          payload: {
            name: live.autoDoc.name,
            generationId: generation!.id,
            ...live.pair,
            documentVersionNumber: live.file.versionNumber,
            formVersionNumber: live.form.versionNumber,
            personId: request.user.id,
            personName: request.user.displayName,
          },
        });
        return { ...live, generation: generation!, displayValues };
      });
      try {
        const template = await buffer(await app.storage.get(accepted.file.fileRef));
        const output = await app.fillEngine.fill({
          template,
          definition: accepted.form.definition,
          answers: accepted.generation.answers,
          displayValues: accepted.displayValues,
        });
        const fileRef = await app.storage.put(
          generationDocxKey(accepted.generation.id),
          Readable.from([output]),
        );
        await withStoredBlob(app.storage, request.log, fileRef, async () => {
          await app.db
            .update(autoDocGenerations)
            .set({ state: "ready", docxFileRef: fileRef, updatedAt: new Date() })
            .where(eq(autoDocGenerations.id, accepted.generation.id));
        });
      } catch (error) {
        request.log.warn(
          { err: error, generationId: accepted.generation.id },
          "Auto-Doc fill failed",
        );
        const detail =
          error instanceof AutoDocFillError
            ? error.message
            : "The Word document could not be generated. Try again.";
        await app.db
          .update(autoDocGenerations)
          .set({ state: "failed", failure: { code: "fill_failed", detail }, updatedAt: new Date() })
          .where(eq(autoDocGenerations.id, accepted.generation.id));
      }
      return reply.code(201).send({
        generation: toGeneration(
          await readGeneration(app.db, request.params.id, accepted.generation.id),
        ),
      });
    },
  );

  app.get(
    "/auto-docs/:id/generations",
    {
      preHandler: requireMember,
      schema: {
        tags: ["Auto-Docs"],
        summary: "List this Auto-Doc's Generations, Member+",
        params: Params,
        response: {
          200: z.object({ generations: z.array(GenerationRow) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [autoDoc] = await app.db
        .select({ id: autoDocs.id })
        .from(autoDocs)
        .where(eq(autoDocs.id, request.params.id));
      if (!autoDoc) throw httpError(404, "No Auto-Doc exists with this id.");
      return {
        generations: (
          await generationQuery(app.db)
            .where(eq(autoDocGenerations.autoDocId, request.params.id))
            .orderBy(desc(autoDocGenerations.createdAt), desc(autoDocGenerations.id))
        ).map(toGeneration),
      };
    },
  );

  app.get(
    "/auto-docs/:id/generations/:generationId",
    {
      preHandler: requireMember,
      schema: {
        tags: ["Auto-Docs"],
        summary: "Read a Generation and its output state, Member+",
        params: GenerationParams,
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => ({
      generation: toGeneration(
        await readGeneration(app.db, request.params.id, request.params.generationId),
      ),
    }),
  );

  app.get(
    "/auto-docs/:id/generations/:generationId/docx",
    {
      preHandler: requireMember,
      schema: {
        tags: ["Auto-Docs"],
        summary: "Download a Generation's Word output, Member+",
        params: GenerationParams,
        response: {
          200: z.any().meta({ type: "string", format: "binary" }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const row = await readGeneration(app.db, request.params.id, request.params.generationId);
      if (!row.generation.docxFileRef)
        throw httpError(
          409,
          row.generation.failure?.detail ?? "The Word document is not ready yet.",
        );
      const body = await app.storage.get(row.generation.docxFileRef);
      return reply
        .header(
          "content-type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .header("content-disposition", attachmentDisposition(`${row.autoDocName}.docx`))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .send(body);
    },
  );
};
