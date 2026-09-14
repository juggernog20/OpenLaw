// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-007: accept one live pair, then fill and store a Generation's own output. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import {
  AUTO_DOC_GENERATION_STATES,
  AUTO_DOC_FORMATS,
  AUTO_DOC_EMAIL_STATES,
  autoDocGenerations,
  autoDocFormVersions,
  autoDocs,
  contracts,
  type CustomFieldValue,
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
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { AUTO_DOC_SLUG } from "../../lib/auto-doc-template.js";
import { AutoDocFillError } from "../../lib/auto-doc-fill/engine.js";
import { entityReachScope } from "../../lib/entity-access.js";
import { HttpError, httpError, problemResponse } from "../../lib/problem.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { attachmentDisposition, withStoredBlobs } from "../../lib/uploads.js";
import { validateGenerationAnswers } from "./answers.js";
import { boundedQueueAsk } from "../../pipeline/jobs.js";
import type { AppDeps } from "../../app.js";
import type { FastifyBaseLogger, FastifyReply } from "fastify";
import type { AutoDocGeneration, AutoDocFormDefinition } from "@openlaw/db";
import { createGeneratedContract } from "./create-contract.js";
import { generationDefinition, prepareContractDestination } from "./contract-destination.js";
import {
  requestDerivations,
  versionStorageKey,
  type AppendedVersion,
} from "../../lib/document-versions.js";
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
export const Pair = z.object({
  documentVersionId: z.string().min(1),
  formVersionId: z.string().min(1),
});
export const Value = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(1000),
]);
const Answers = z.record(z.string().regex(AUTO_DOC_SLUG), Value);
export const GenerationRow = z.object({
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
  hasPdf: z.boolean(),
  createdContract: z
    .object({ id: z.string(), number: z.number().int(), title: z.string() })
    .nullable(),
  formats: z.enum(AUTO_DOC_FORMATS),
  emailState: z.enum(AUTO_DOC_EMAIL_STATES),
  emailSentAt: z.iso.datetime().nullable(),
  emailFailure: z.object({ code: z.string(), detail: z.string() }).nullable(),
  failure: z.object({ code: z.string(), detail: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const Envelope = z.object({ generation: GenerationRow });

export async function livePair(tx: Transaction, id: string, submitted?: z.infer<typeof Pair>) {
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

export function generationQuery(db: Executor, user: AuthenticatedUser) {
  return db
    .select({
      generation: autoDocGenerations,
      autoDocName: autoDocs.name,
      createdContract: { id: contracts.id, number: contracts.number, title: contracts.title },
      person: { id: users.id, displayName: users.displayName },
      documentVersionNumber: documentVersions.versionNumber,
      formVersionNumber: autoDocFormVersions.versionNumber,
    })
    .from(autoDocGenerations)
    .innerJoin(autoDocs, eq(autoDocs.id, autoDocGenerations.autoDocId))
    .innerJoin(users, eq(users.id, autoDocGenerations.generatedBy))
    .leftJoin(
      contracts,
      and(eq(contracts.id, autoDocGenerations.createdContractId), contractTeamScope(db, user)),
    )
    .innerJoin(documentVersions, eq(documentVersions.id, autoDocGenerations.documentVersionId))
    .innerJoin(autoDocFormVersions, eq(autoDocFormVersions.id, autoDocGenerations.formVersionId));
}
export function toGeneration(row: Awaited<ReturnType<typeof generationQuery>>[number]) {
  const { docxFileRef, pdfFileRef, ...generation } = row.generation;
  return {
    ...generation,
    autoDocName: row.autoDocName,
    createdContract: row.createdContract,
    person: row.person,
    documentVersionNumber: row.documentVersionNumber,
    formVersionNumber: row.formVersionNumber,
    hasDocx: docxFileRef !== null,
    hasPdf: pdfFileRef !== null,
    emailSentAt: generation.emailSentAt?.toISOString() ?? null,
    createdAt: generation.createdAt.toISOString(),
    updatedAt: generation.updatedAt.toISOString(),
  };
}
export async function readGeneration(
  db: Executor,
  user: AuthenticatedUser,
  id: string,
  generationId: string,
) {
  const [row] = await generationQuery(db, user).where(
    and(eq(autoDocGenerations.id, generationId), eq(autoDocGenerations.autoDocId, id)),
  );
  if (!row) throw httpError(404, "No Generation exists with this id on this Auto-Doc.");
  return row;
}

type GenerationDeps = Pick<AppDeps, "db" | "storage" | "fillEngine" | "jobs" | "notifier">;
async function fillGeneration(
  app: GenerationDeps,
  log: FastifyBaseLogger,
  generation: AutoDocGeneration,
  definition: AutoDocFormDefinition,
  sourceRef: string,
) {
  const current = and(
    eq(autoDocGenerations.id, generation.id),
    eq(autoDocGenerations.attempt, generation.attempt),
    eq(autoDocGenerations.state, "pending"),
  );
  let stage: "fill" | "contract" = "fill";
  let primary: AppendedVersion | undefined;
  try {
    const template = await buffer(await app.storage.get(sourceRef));
    const output = await app.fillEngine.fill({
      template,
      definition,
      answers: generation.answers,
      displayValues: generation.displayValues,
    });
    const fileRef = await app.storage.put(
      generationDocxKey(generation.id),
      Readable.from([output]),
    );
    // The cleanup list stays the live array rather than a copy of it.
    // The Contract Document's own blob is pushed below, after this call
    // has taken the list, and a rollback has to remove that one too.
    const stored = [fileRef];
    await withStoredBlobs(app.storage, log, stored, async () => {
      await app.notifier.notifying(async (tx) => {
        const [held] = await tx.select().from(autoDocGenerations).where(current).for("update");
        if (!held) throw new AutoDocFillError("This fill attempt has been replaced.");
        if (held.contractSnapshot && !held.createdContractId) {
          stage = "contract";
          const documentId = uuidv7();
          const versionId = uuidv7();
          const copy = await app.storage.put(
            versionStorageKey(documentId, versionId),
            Readable.from([output]),
          );
          stored.push(copy);
          primary = {
            documentId,
            versionId,
            versionNumber: 1,
            fileRef: copy,
            kind: "draft_ours",
            source: "generated",
            generatedFromGenerationId: generation.id,
            comparedFromVersionId: null,
            comparedToVersionId: null,
            note: null,
            originalFilename: `${held.contractSnapshot.autoDocName}.docx`,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            byteSize: output.length,
            checksumSha256: createHash("sha256").update(output).digest("hex"),
            createdBy: generation.generatedBy,
          };
        }
        const links = primary ? await createGeneratedContract(tx, app.notifier, held, primary) : {};
        await tx
          .update(autoDocGenerations)
          .set({
            ...links,
            state: generation.formats === "docx" ? "ready" : "pending",
            docxFileRef: fileRef,
            updatedAt: new Date(),
          })
          .where(current);
      });
    });
  } catch (error) {
    log.warn({ err: error, generationId: generation.id }, "Auto-Doc Generation failed");
    const detail =
      error instanceof AutoDocFillError || (error instanceof HttpError && error.statusCode < 500)
        ? error.message
        : stage === "fill"
          ? "The Word document could not be generated. Try again."
          : "The Contract could not be created. Retry this Generation.";
    await app.db
      .update(autoDocGenerations)
      .set({
        state: "failed",
        failure: { code: stage === "fill" ? "fill_failed" : "contract_failed", detail },
        updatedAt: new Date(),
      })
      .where(current);
    return;
  }
  if (primary) await requestDerivations(app.jobs, log, primary);
  try {
    await boundedQueueAsk(app.jobs.requestGenerationDelivery(generation.id, generation.attempt));
  } catch (error) {
    log.warn(
      { err: error, generationId: generation.id },
      "Generation delivery remains owed; the sweep will ask again",
    );
  }
}

export interface GenerationSubmission {
  documentVersionId: string;
  formVersionId: string;
  answers: Record<string, CustomFieldValue | null>;
  businessOwnerId?: string | null;
}

/** Portal policy runs in the acceptance transaction, before consuming the submitted pair. */
export async function generateAutoDoc(
  app: GenerationDeps,
  log: FastifyBaseLogger,
  user: AuthenticatedUser,
  id: string,
  submission: GenerationSubmission,
  authorise?: (tx: Transaction) => Promise<void>,
) {
  const accepted = await app.db.transaction(async (tx) => {
    await authorise?.(tx);
    const live = await livePair(tx, id, submission);
    const definition = generationDefinition(live.autoDoc, live.form.definition);
    const raw = { ...submission.answers };
    if (live.autoDoc.targetContractTypeId && live.autoDoc.fixedEntityId)
      for (const field of definition.fields)
        if (field.fieldType === "entity") raw[field.slug] = live.autoDoc.fixedEntityId;
    const { answers, displayValues } = await validateGenerationAnswers(tx, user, definition, raw);
    const contractSnapshot = await prepareContractDestination(
      tx,
      user,
      live.autoDoc,
      definition,
      answers,
      displayValues,
      submission.businessOwnerId,
    );
    const [generation] = await tx
      .insert(autoDocGenerations)
      .values({
        autoDocId: live.autoDoc.id,
        ...live.pair,
        generatedBy: user.id,
        answers,
        displayValues,
        contractSnapshot,
        formats: live.autoDoc.formats,
        coverNote: live.autoDoc.coverNote,
        emailState: "pending",
      })
      .returning();
    await recordActivity(tx, {
      entityType: "auto_doc",
      entityId: live.autoDoc.id,
      actorId: user.id,
      action: "auto_doc.generated",
      visibility: "legal_only",
      payload: {
        name: live.autoDoc.name,
        generationId: generation!.id,
        ...live.pair,
        documentVersionNumber: live.file.versionNumber,
        formVersionNumber: live.form.versionNumber,
        personId: user.id,
        personName: user.displayName,
      },
    });
    return { ...live, generation: generation! };
  });
  await fillGeneration(
    app,
    log,
    accepted.generation,
    accepted.form.definition,
    accepted.file.fileRef,
  );
  return toGeneration(await readGeneration(app.db, user, id, accepted.generation.id));
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
              targetContractTypeId: z.string().nullable(),
              fixedEntityId: z.string().nullable(),
            }),
            pair: Pair,
            fields: z.array(AutoDocFieldRow),
            entities: z.array(z.object({ id: z.string(), name: z.string() })),
            businessOwners: z.array(z.object({ id: z.string(), name: z.string() })),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const { autoDoc, pair, form } = await livePair(tx, request.params.id);
        const definition = generationDefinition(autoDoc, form.definition);
        const fixed = autoDoc.targetContractTypeId && autoDoc.fixedEntityId;
        const options =
          !fixed && definition.fields.some((field) => field.fieldType === "entity")
            ? await tx
                .select({ id: entities.id, name: entities.legalName })
                .from(entities)
                .where(and(isNull(entities.archivedAt), entityReachScope(tx, request.user)))
                .orderBy(asc(entities.legalName))
            : [];
        return {
          autoDoc: {
            id: autoDoc.id,
            name: autoDoc.name,
            description: autoDoc.description,
            targetContractTypeId: autoDoc.targetContractTypeId,
            fixedEntityId: autoDoc.fixedEntityId,
          },
          pair,
          fields: definition.fields
            .filter((field) => !fixed || field.fieldType !== "entity")
            .map((field) => ({
              ...field,
              catalogFieldId: field.catalogFieldId ?? null,
              contractAttribute: field.contractAttribute ?? null,
            })),
          entities: options,
          businessOwners: autoDoc.targetContractTypeId
            ? await tx
                .select({ id: users.id, name: users.displayName })
                .from(users)
                .where(isNull(users.archivedAt))
                .orderBy(asc(users.displayName))
            : [],
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
          businessOwnerId: z.string().min(1).nullable().optional(),
        }).strict(),
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        generation: await generateAutoDoc(
          app,
          request.log,
          request.user,
          request.params.id,
          request.body,
        ),
      }),
  );

  app.post(
    "/auto-docs/:id/generations/:generationId/retry",
    {
      preHandler: requireMember,
      schema: {
        tags: ["Auto-Docs"],
        summary: "Retry a failed Generation with its original pair and answers, Member+",
        params: GenerationParams,
        body: z.strictObject({}),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => {
      const accepted = await app.db.transaction(async (tx) => {
        const [old] = await tx
          .select()
          .from(autoDocGenerations)
          .where(
            and(
              eq(autoDocGenerations.id, request.params.generationId),
              eq(autoDocGenerations.autoDocId, request.params.id),
            ),
          )
          .for("update");
        if (!old) throw httpError(404, "No Generation exists with this id on this Auto-Doc.");
        if (old.state !== "failed")
          throw httpError(409, "Only a failed Generation can be retried.");
        const [file] = await tx
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.id, old.documentVersionId))
          .for("share");
        const [form] = await tx
          .select()
          .from(autoDocFormVersions)
          .where(eq(autoDocFormVersions.id, old.formVersionId))
          .for("share");
        if (!file || !form)
          throw httpError(409, "This Generation's original pair is no longer available.");
        const displayValues = { ...old.displayValues };
        for (const field of form.definition.fields) {
          if (
            field.fieldType !== "entity" ||
            Object.hasOwn(displayValues, field.slug) ||
            !Object.hasOwn(old.answers, field.slug)
          )
            continue;
          const value = old.answers[field.slug];
          if (typeof value !== "string") continue;
          const [entity] = await tx
            .select({ name: entities.legalName })
            .from(entities)
            .where(eq(entities.id, value));
          if (!entity)
            throw httpError(409, `The Entity used for "${field.label}" is no longer available.`);
          displayValues[field.slug] = entity.name;
        }
        const [generation] = await tx
          .update(autoDocGenerations)
          .set({
            state: "pending",
            failure: null,
            docxFileRef: null,
            pdfFileRef: null,
            emailState: "pending",
            emailFailure: null,
            emailSentAt: null,
            displayValues,
            attempt: old.attempt + 1,
            updatedAt: new Date(),
          })
          .where(eq(autoDocGenerations.id, old.id))
          .returning();
        const [autoDoc] = await tx
          .select({ name: autoDocs.name })
          .from(autoDocs)
          .where(eq(autoDocs.id, old.autoDocId));
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: old.autoDocId,
          actorId: request.user.id,
          action: "auto_doc.generation_retried",
          visibility: "legal_only",
          payload: { name: autoDoc!.name, generationId: old.id },
        });
        return {
          generation: generation!,
          file,
          form,
          superseded: [old.docxFileRef, old.pdfFileRef],
        };
      });
      // The retry mints fresh keys (DOC-012), so the output of the
      // attempt it replaced is referenced by nothing from here on. The
      // removal is best effort, for the display rendition's reason. An
      // orphan is harmless, and failing to tidy one up must not refuse a
      // retry the row has already recorded.
      for (const fileRef of accepted.superseded)
        if (fileRef)
          await app.storage.delete(fileRef).catch((error: unknown) => {
            request.log.warn(
              { err: error, fileRef },
              "could not remove the output of a replaced Generation attempt",
            );
          });
      await fillGeneration(
        app,
        request.log,
        accepted.generation,
        accepted.form.definition,
        accepted.file.fileRef,
      );
      return {
        generation: toGeneration(
          await readGeneration(app.db, request.user, request.params.id, accepted.generation.id),
        ),
      };
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
          await generationQuery(app.db, request.user)
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
        await readGeneration(app.db, request.user, request.params.id, request.params.generationId),
      ),
    }),
  );

  for (const format of ["docx", "pdf"] as const)
    app.get(
      `/auto-docs/:id/generations/:generationId/${format}`,
      {
        preHandler: requireMember,
        schema: {
          tags: ["Auto-Docs"],
          summary: `Download a Generation's ${format} output, Member+`,
          produces: [
            format === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "application/pdf",
          ],
          params: GenerationParams,
          response: {
            200: z.any().meta({ type: "string", format: "binary" }),
            default: problemResponse,
          },
        },
      },
      async (request, reply) => {
        const row = await readGeneration(
          app.db,
          request.user,
          request.params.id,
          request.params.generationId,
        );
        return downloadGeneration(app, reply, row, format);
      },
    );
};

/** Both destinations enforce reach before handing the owned output to this download path. */
export async function downloadGeneration(
  app: Pick<AppDeps, "storage">,
  reply: FastifyReply,
  row: Awaited<ReturnType<typeof readGeneration>>,
  format: "docx" | "pdf",
) {
  if (row.generation.formats !== "both" && row.generation.formats !== format)
    throw httpError(
      403,
      `This Generation does not allow ${format === "docx" ? "Word" : "PDF"} downloads.`,
    );
  const fileRef = format === "docx" ? row.generation.docxFileRef : row.generation.pdfFileRef;
  if (!fileRef)
    throw httpError(
      409,
      row.generation.failure?.detail ??
        `The ${format === "docx" ? "Word document" : "PDF"} is not ready yet.`,
    );
  return reply
    .header(
      "content-type",
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    )
    .header("content-disposition", attachmentDisposition(`${row.autoDocName}.${format}`))
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "private, no-store")
    .send(await app.storage.get(fileRef));
}
