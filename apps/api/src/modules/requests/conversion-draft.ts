// SPDX-License-Identifier: AGPL-3.0-only
/** Actor-scoped preparation and source evidence for Matter conversion (INT-008). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  conversionDrafts,
  eq,
  isNull,
  matterTypeFields,
  matters,
  requests,
  type Executor,
} from "@openlaw/db";
import type { ConversionProvenanceMap } from "@openlaw/shared";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { requireAuth, requireRole } from "../../auth/guards.js";
import {
  ConversionSuggestionSchema,
  conversionContext,
  conversionSources,
  matterPreparationEnabled,
  normalizeQuote,
} from "../../lib/conversion-draft.js";
import { selectAttachedFields } from "../../lib/custom-fields.js";
import { reachedMatter } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { boundedQueueAsk } from "../../pipeline/jobs.js";

const DraftSchema = z.object({
  id: z.string(),
  targetTypeId: z.string(),
  state: z.enum(["pending", "ready", "failed"]),
  suggestions: z.record(z.string(), ConversionSuggestionSchema),
  conflicts: z.record(z.string(), ConversionSuggestionSchema),
  warnings: z.array(z.string()),
  failure: z.string().nullable(),
});
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
        response: { 200: z.object({ matterPreparation: z.boolean() }), default: problemResponse },
      },
    },
    async () => ({ matterPreparation: await matterPreparationEnabled(app.db) }),
  );
  app.post(
    "/requests/:number/conversion-drafts",
    {
      preHandler: gate,
      schema: {
        operationId: "prepareConversionDraft",
        params,
        body: z.strictObject({
          targetModule: z.literal("matter"),
          targetTypeId: z.string(),
          retry: z.boolean().optional(),
        }),
        response: { 202: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      if (!(await matterPreparationEnabled(app.db)))
        throw httpError(409, "Matter preparation is turned off. Continue manually.");
      const row = await requestOf(app.db, request.params.number);
      if (row.status !== "new")
        throw httpError(409, "This Request has already been dispositioned.");
      const context = await conversionContext(app.db, row.id, request.body.targetTypeId);
      const key = {
        requestId: row.id,
        actorId: request.user.id,
        targetModule: "matter" as const,
        targetTypeId: request.body.targetTypeId,
        snapshot: context.snapshot,
      };
      await app.db.insert(conversionDrafts).values(key).onConflictDoNothing();
      const [found] = await app.db
        .select()
        .from(conversionDrafts)
        .where(
          and(
            eq(conversionDrafts.requestId, key.requestId),
            eq(conversionDrafts.actorId, key.actorId),
            eq(conversionDrafts.targetTypeId, key.targetTypeId),
            eq(conversionDrafts.targetModule, "matter"),
            eq(conversionDrafts.snapshot, key.snapshot),
          ),
        );
      let draft = found!;
      if (request.body.retry && draft.state === "failed") {
        const [retried] = await app.db
          .update(conversionDrafts)
          .set({
            state: "pending",
            startedAt: null,
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
      return { draft };
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
          (await matterPreparationEnabled(app.db)) &&
          (await conversionContext(app.db, row.id, draft.targetTypeId)).snapshot === draft.snapshot;
      } catch {
        /* A changed or missing source makes the draft unavailable. */
      }
      return {
        draft: current
          ? draft
          : {
              ...draft,
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
          200: z.object({
            available: z.boolean(),
            citations: z.array(
              z.object({
                label: z.string(),
                text: z.string(),
                quote: z.string(),
                sourceId: z.string(),
              }),
            ),
          }),
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
      const citations = (proposal?.citations ?? []).flatMap((citation) => {
        const live = source.sources.find(
          (s) => s.id === citation.sourceId && s.revision === citation.revision,
        );
        return live
          ? [{ label: live.label, text: live.text, quote: citation.quote, sourceId: live.id }]
          : [];
      });
      return {
        available: citations.length > 0 && citations.length === proposal?.citations.length,
        citations: citations.length === proposal?.citations.length ? citations : [],
      };
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
          200: z.object({
            available: z.boolean(),
            citations: z.array(
              z.object({
                label: z.string(),
                text: z.string(),
                quote: z.string(),
                sourceId: z.string(),
              }),
            ),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const row = await reachedMatter(app.db, request.user, request.params.number);
      if (!row || row.archivedAt) throw httpError(404, "The Matter is unavailable.");
      const flag = row.aiUnverified?.[request.params.slug];
      if (!flag) return { available: false, citations: [] };
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
      const citations = (proposal?.citations ?? []).flatMap((citation) => {
        const live = source.sources.find(
          (s) =>
            s.id === citation.sourceId &&
            s.revision === citation.revision &&
            normalizeQuote(s.text).includes(normalizeQuote(citation.quote)),
        );
        return live
          ? [{ label: live.label, text: live.text, quote: citation.quote, sourceId: live.id }]
          : [];
      });
      return {
        available: citations.length > 0 && citations.length === proposal?.citations.length,
        citations: citations.length === proposal?.citations.length ? citations : [],
      };
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
    values: Record<string, unknown>;
  },
): Promise<ConversionProvenanceMap | null> {
  if (!input.accepted?.length) return null;
  if (!input.id || !(await matterPreparationEnabled(db, true)))
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
  if (!draft || draft.targetModule !== "matter")
    throw httpError(409, "The Conversion draft is unavailable.");
  const context = await conversionContext(db, input.requestId, draft.targetTypeId, true);
  if (context.snapshot !== draft.snapshot)
    throw httpError(
      409,
      "The Request sources changed. Prepare a new Conversion draft or continue manually.",
    );
  const flags: ConversionProvenanceMap = {};
  const typeMatches = context.types.some((type) => type.id === input.typeId);
  for (const slug of input.accepted) {
    const suggestion = draft.suggestions[slug];
    if (
      !typeMatches ||
      !suggestion ||
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
