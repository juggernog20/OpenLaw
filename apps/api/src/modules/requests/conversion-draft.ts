// SPDX-License-Identifier: AGPL-3.0-only
/** Actor-scoped preparation and source evidence for Request conversion (INT-008). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  conversionDrafts,
  contracts,
  eq,
  isNull,
  matterTypeFields,
  contractTypeFields,
  matters,
  requests,
  type Executor,
} from "@openlaw/db";
import type { ConversionProvenanceMap } from "@openlaw/shared";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { requireAuth, requireRole } from "../../auth/guards.js";
import {
  ConversionSuggestionSchema,
  isCarriedConversionValue,
  conversionContext,
  conversionSources,
  preparationEnabled,
} from "../../lib/conversion-draft.js";
import { selectAttachedFields } from "../../lib/custom-fields.js";
import { reachedMatter } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { authorizedAttachment, conversionEvidence, EvidenceSchema } from "./conversion-evidence.js";
import { attachmentDisposition, inlineDisposition } from "../../lib/uploads.js";
import { boundedBytes } from "../../lib/conversion-attachments.js";
import { reachedContract } from "../../lib/contract-access.js";
import { boundedQueueAsk } from "../../pipeline/jobs.js";

const DownloadSchema = z.any().meta({ type: "string", format: "binary" });
const DraftSchema = z.object({
  id: z.string(),
  targetModule: z.enum(["matter", "contract"]),
  targetTypeId: z.string(),
  state: z.enum(["pending", "ready", "failed"]),
  progressAt: z.iso.datetime().optional(),
  suggestions: z.record(z.string(), ConversionSuggestionSchema),
  conflicts: z.record(z.string(), ConversionSuggestionSchema),
  warnings: z.array(z.string()),
  attachmentReads: z.array(
    z.object({
      sourceId: z.string(),
      label: z.string(),
      status: z.enum(["readable", "unreadable", "unsupported", "truncated", "omitted"]),
      reason: z.string().optional(),
    }),
  ),
  failure: z.string().nullable(),
});
function draftPayload(draft: typeof conversionDrafts.$inferSelect) {
  return DraftSchema.parse({
    ...draft,
    progressAt: (draft.leaseAt ?? draft.startedAt ?? draft.createdAt).toISOString(),
  });
}
const Envelope = z.object({ draft: DraftSchema });
const params = z.object({ number: z.coerce.number().int().positive() });
async function requestOf(db: Executor, number: number) {
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.number, number), isNull(requests.archivedAt)))
    .limit(1);
  if (!row) throw httpError(404, "The Request is unavailable.");
  return row;
}
export const conversionDraftRoutes: FastifyPluginAsyncZod = async (app) => {
  const gate = requireRole("administrator", "legal_team_member");
  app.get(
    "/conversion-drafts/settings",
    {
      preHandler: gate,
      schema: {
        operationId: "getConversionDraftSettings",
        response: {
          200: z.object({ matterPreparation: z.boolean(), contractPreparation: z.boolean() }),
          default: problemResponse,
        },
      },
    },
    async () => ({
      matterPreparation: await preparationEnabled(app.db, "matter"),
      contractPreparation: await preparationEnabled(app.db, "contract"),
    }),
  );
  app.post(
    "/requests/:number/conversion-drafts",
    {
      preHandler: gate,
      schema: {
        operationId: "prepareConversionDraft",
        params,
        body: z.strictObject({
          targetModule: z.enum(["matter", "contract"]),
          targetTypeId: z.string(),
          retry: z.boolean().optional(),
        }),
        response: { 202: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      if (!(await preparationEnabled(app.db, request.body.targetModule)))
        throw httpError(409, "Preparation is turned off. Continue manually.");
      const row = await requestOf(app.db, request.params.number);
      if (row.status !== "new")
        throw httpError(409, "This Request has already been dispositioned.");
      const context = await conversionContext(
        app.db,
        row.id,
        request.body.targetTypeId,
        false,
        request.body.targetModule,
      );
      const key = {
        requestId: row.id,
        actorId: request.user.id,
        targetModule: request.body.targetModule,
        targetTypeId: request.body.targetTypeId,
        snapshot: context.snapshot,
      };
      await app.db
        .insert(conversionDrafts)
        .values(key)
        .onConflictDoNothing({
          target: [
            conversionDrafts.requestId,
            conversionDrafts.actorId,
            conversionDrafts.targetModule,
            conversionDrafts.targetTypeId,
            conversionDrafts.snapshot,
          ],
        });
      const [found] = await app.db
        .select()
        .from(conversionDrafts)
        .where(
          and(
            eq(conversionDrafts.requestId, key.requestId),
            eq(conversionDrafts.actorId, key.actorId),
            eq(conversionDrafts.targetTypeId, key.targetTypeId),
            eq(conversionDrafts.targetModule, key.targetModule),
            eq(conversionDrafts.snapshot, key.snapshot),
          ),
        );
      if (!found) throw httpError(409, "Preparation changed. Try again.");
      let draft = found;
      if (request.body.retry && draft.state === "failed") {
        const [retried] = await app.db
          .update(conversionDrafts)
          .set({
            state: "pending",
            startedAt: null,
            leaseAt: null,
            finishedAt: null,
            failure: null,
            suggestions: {},
            conflicts: {},
          })
          .where(and(eq(conversionDrafts.id, draft.id), eq(conversionDrafts.state, "failed")))
          .returning();
        draft = retried ?? draft;
      }
      if (draft.state === "pending")
        await boundedQueueAsk(app.jobs.requestConversionDraft(draft.id)).catch(() => {});
      reply.code(202);
      return { draft: draftPayload(draft) };
    },
  );
  app.get(
    "/requests/:number/conversion-drafts/:draftId",
    {
      preHandler: gate,
      schema: {
        operationId: "getConversionDraft",
        params: params.extend({ draftId: z.string() }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await requestOf(app.db, request.params.number);
      const [draft] = await app.db
        .select()
        .from(conversionDrafts)
        .where(
          and(
            eq(conversionDrafts.id, request.params.draftId),
            eq(conversionDrafts.requestId, row.id),
            eq(conversionDrafts.actorId, request.user.id),
          ),
        );
      if (!draft) throw httpError(404, "The Conversion draft is unavailable.");
      let current = false;
      try {
        current =
          row.status === "new" &&
          (await preparationEnabled(app.db, draft.targetModule)) &&
          (await conversionContext(app.db, row.id, draft.targetTypeId, false, draft.targetModule))
            .snapshot === draft.snapshot;
      } catch {
        /* A changed or missing source makes the draft unavailable. */
      }
      return {
        draft: current
          ? draftPayload(draft)
          : {
              ...draftPayload(draft),
              attachmentReads: [],
              state: "failed" as const,
              suggestions: {},
              conflicts: {},
              failure: "The sources or settings changed. Retry or continue manually.",
            },
      };
    },
  );
  app.get(
    "/requests/:number/conversion-drafts/:draftId/evidence/:slug",
    {
      preHandler: gate,
      schema: {
        operationId: "getConversionDraftEvidence",
        params: params.extend({ draftId: z.string(), slug: z.string() }),
        response: {
          200: EvidenceSchema,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const row = await requestOf(app.db, request.params.number);
      const [draft] = await app.db
        .select()
        .from(conversionDrafts)
        .where(
          and(
            eq(conversionDrafts.id, request.params.draftId),
            eq(conversionDrafts.requestId, row.id),
            eq(conversionDrafts.actorId, request.user.id),
          ),
        );
      if (!draft) throw httpError(404, "The Conversion draft is unavailable.");
      const source = await conversionSources(app.db, row.id);
      const proposal =
        draft.suggestions[request.params.slug] ?? draft.conflicts[request.params.slug];
      if (row.status !== "new") throw httpError(404, "The Conversion draft is unavailable.");
      return conversionEvidence(app.db, request.user, source, draft, proposal);
    },
  );
  app.get(
    "/matters/:number/conversion-evidence/:slug",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getMatterConversionEvidence",
        params: params.extend({ slug: z.string() }),
        response: {
          200: EvidenceSchema,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const row = await reachedMatter(app.db, request.user, request.params.number);
      if (!row || row.archivedAt) throw httpError(404, "The Matter is unavailable.");
      const flag = row.aiUnverified?.[request.params.slug];
      if (!flag?.draftId) return { available: false, citations: [] };
      if (request.params.slug.startsWith("field:")) {
        const fields = await selectAttachedFields(app.db, matterTypeFields, row.matterTypeId);
        const field = fields.find((f) => `field:${f.slug}` === request.params.slug);
        if (
          !field ||
          (field.fieldTag === "legal" &&
            !["administrator", "legal_team_member"].includes(request.user.role))
        )
          return { available: false, citations: [] };
      }
      const [draft] = await app.db
        .select()
        .from(conversionDrafts)
        .where(eq(conversionDrafts.id, flag.draftId));
      if (!draft) return { available: false, citations: [] };
      const source = await conversionSources(app.db, draft.requestId).catch(() => null);
      if (!source || source.row.convertedMatterId !== row.id)
        return { available: false, citations: [] };
      const proposal = draft.suggestions[request.params.slug];
      return conversionEvidence(app.db, request.user, source, draft, proposal);
    },
  );
  app.get(
    "/contracts/:number/conversion-evidence/:slug",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getContractConversionEvidence",
        params: params.extend({ slug: z.string() }),
        response: {
          200: EvidenceSchema,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const row = await reachedContract(app.db, request.user, request.params.number);
      if (!row || row.archivedAt) throw httpError(404, "The Contract is unavailable.");
      const flag = row.aiUnverified?.[request.params.slug];
      if (!flag?.draftId) return { available: false, citations: [] };
      if (request.params.slug.startsWith("field:")) {
        const fields = await selectAttachedFields(app.db, contractTypeFields, row.contractTypeId);
        const field = fields.find((f) => `field:${f.slug}` === request.params.slug);
        if (
          !field ||
          (field.fieldTag === "legal" &&
            !["administrator", "legal_team_member"].includes(request.user.role))
        )
          return { available: false, citations: [] };
      }
      const [draft] = await app.db
        .select()
        .from(conversionDrafts)
        .where(eq(conversionDrafts.id, flag.draftId));
      if (!draft) return { available: false, citations: [] };
      const source = await conversionSources(app.db, draft.requestId).catch(() => null);
      if (!source || source.row.convertedContractId !== row.id)
        return { available: false, citations: [] };
      const proposal = draft.suggestions[request.params.slug];
      return conversionEvidence(app.db, request.user, source, draft, proposal);
    },
  );
  for (const mode of ["preview", "download"] as const)
    app.get(
      `/requests/:number/conversion-drafts/:draftId/sources/:sourceId/${mode}`,
      {
        preHandler: requireAuth,
        schema: {
          operationId:
            mode === "preview" ? "previewConversionAttachment" : "downloadConversionAttachment",
          params: params.extend({ draftId: z.string(), sourceId: z.string() }),
          produces: [mode === "preview" ? "application/pdf" : "application/octet-stream"],
          response: { 200: DownloadSchema, default: problemResponse },
        },
      },
      async (request, reply) => {
        const row = await requestOf(app.db, request.params.number);
        const [draft] = await app.db
          .select()
          .from(conversionDrafts)
          .where(
            and(
              eq(conversionDrafts.id, request.params.draftId),
              eq(conversionDrafts.requestId, row.id),
            ),
          );
        if (!draft) throw httpError(404, "The source is unavailable.");
        if (row.status === "new") {
          if (
            draft.actorId !== request.user.id ||
            !["administrator", "legal_team_member"].includes(request.user.role)
          )
            throw httpError(404, "The source is unavailable.");
        } else if (row.convertedMatterId) {
          const [matter] = await app.db
            .select({ number: matters.number })
            .from(matters)
            .where(eq(matters.id, row.convertedMatterId));
          const reached = matter && (await reachedMatter(app.db, request.user, matter.number));
          if (!reached || reached.archivedAt) throw httpError(404, "The source is unavailable.");
        } else if (row.convertedContractId) {
          const [contract] = await app.db
            .select({ number: contracts.number })
            .from(contracts)
            .where(eq(contracts.id, row.convertedContractId));
          const reached =
            contract && (await reachedContract(app.db, request.user, contract.number));
          if (!reached || reached.archivedAt) throw httpError(404, "The source is unavailable.");
        } else throw httpError(404, "The source is unavailable.");
        const sources = await conversionSources(app.db, row.id);
        const read = draft.attachmentReads.find((r) => r.sourceId === request.params.sourceId);
        const authorized =
          read && (await authorizedAttachment(app.db, request.user, sources, read));
        if (!read || !authorized || authorized.version)
          throw httpError(404, "The source is unavailable.");
        const ref = mode === "preview" ? read.previewRef : authorized.file.fileRef;
        if (!ref)
          throw httpError(415, "This source has no passage preview. Download it to read it.");
        reply
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff");
        reply.header(
          "content-disposition",
          mode === "preview"
            ? inlineDisposition(read.method === "converted" ? `${read.label}.pdf` : read.label)
            : attachmentDisposition(read.label),
        );
        reply.header(
          "content-type",
          mode === "preview" ? "application/pdf" : "application/octet-stream",
        );
        const bytes = await boundedBytes(await app.storage.get(ref));
        reply.header("content-length", bytes.length);
        if (mode === "preview")
          reply.header("content-security-policy", "default-src 'none'; sandbox");
        return reply.send(bytes);
      },
    );
  app.post(
    "/matters/:number/conversion-confirm/:slug",
    {
      preHandler: gate,
      schema: {
        operationId: "confirmMatterConversionValue",
        params: params.extend({ slug: z.string() }),
        response: { 200: z.object({ ok: z.literal(true) }), default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const row = await reachedMatter(tx, request.user, request.params.number, { lock: true });
        if (!row || row.archivedAt) throw httpError(404, "The Matter is unavailable.");
        if (!row.aiUnverified?.[request.params.slug])
          throw httpError(400, "That value is not awaiting confirmation.");
        const flags = { ...row.aiUnverified };
        delete flags[request.params.slug];
        await tx
          .update(matters)
          .set({ aiUnverified: Object.keys(flags).length ? flags : null })
          .where(eq(matters.id, row.id));
        await recordActivity(tx, {
          entityType: "matter",
          entityId: row.id,
          actorId: request.user.id,
          action: "matter.field_confirmed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: row.number, title: row.title, slug: request.params.slug },
        });
      });
      return { ok: true as const };
    },
  );
};

export async function acceptedConversionProvenance(
  db: Executor,
  input: {
    id?: string;
    accepted?: string[];
    actorId: string;
    requestId: string;
    typeId: string;
    targetModule: "matter" | "contract";
    values: Record<string, unknown>;
  },
): Promise<ConversionProvenanceMap | null> {
  if (!input.accepted?.length) return null;
  if (!input.id || !(await preparationEnabled(db, input.targetModule, true)))
    throw httpError(409, "The Conversion draft is unavailable. Continue manually.");
  const [draft] = await db
    .select()
    .from(conversionDrafts)
    .where(
      and(
        eq(conversionDrafts.id, input.id),
        eq(conversionDrafts.requestId, input.requestId),
        eq(conversionDrafts.actorId, input.actorId),
        eq(conversionDrafts.state, "ready"),
      ),
    );
  if (
    !draft ||
    draft.targetModule !== input.targetModule ||
    (draft.targetTypeId && draft.targetTypeId !== input.typeId)
  )
    throw httpError(409, "The Conversion draft is unavailable.");
  const context = await conversionContext(
    db,
    input.requestId,
    draft.targetTypeId,
    true,
    draft.targetModule,
  );
  if (context.snapshot !== draft.snapshot)
    throw httpError(
      409,
      "The Request sources changed. Prepare a new Conversion draft or continue manually.",
    );
  const flags: ConversionProvenanceMap = {};
  const typeMatches =
    context.types.some((type) => type.id === input.typeId) &&
    (!draft.targetTypeId || draft.targetTypeId === input.typeId);
  for (const slug of input.accepted) {
    const suggestion = draft.suggestions[slug];
    if (
      !typeMatches ||
      !Object.hasOwn(draft.suggestions, slug) ||
      !Object.hasOwn(input.values, slug) ||
      !suggestion ||
      isCarriedConversionValue(slug, suggestion.value, context.row) ||
      JSON.stringify(suggestion.value) !== JSON.stringify(input.values[slug])
    )
      continue;
    flags[slug] = {
      draftId: draft.id,
      writtenAt: new Date().toISOString(),
      targetTypeId: input.typeId,
    };
  }
  return Object.keys(flags).length ? flags : null;
}
