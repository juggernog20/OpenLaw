// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-008–010: current audience gates each Portal use and the generator's own history. */
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES,
  AUTO_DOC_FORMATS,
  and,
  asc,
  autoDocGenerations,
  autoDocs,
  desc,
  eq,
  lt,
  type Executor,
} from "@openlaw/db";
import { requireAuth, type AuthenticatedUser } from "../../auth/guards.js";
import { AUTO_DOC_SLUG } from "../../lib/auto-doc-template.js";
import { listPortalEntities } from "../../lib/portal-entities.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { generationDefinition } from "../auto-docs/contract-destination.js";
import {
  downloadGeneration,
  Envelope,
  generateAutoDoc,
  GenerationRow,
  generationQuery,
  livePair,
  Pair,
  toGeneration,
  Value,
} from "../auto-docs/generations.js";
import {
  acceptAcknowledgement,
  acknowledgementState,
  authorisePortalGeneration,
  lockPortalPerson,
  portalAutoDocScope,
  portalWarnings,
  portalWarningsFor,
  PORTAL_UNAVAILABLE,
  readPortalAutoDoc,
} from "../auto-docs/portal-policy.js";
import { AutoDocFieldRow } from "../auto-docs/routes.js";

const Params = z.object({ id: z.string() });
const GenerationParams = Params.extend({ generationId: z.string() });
const AutoDoc = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  formats: z.enum(AUTO_DOC_FORMATS),
  createsContract: z.boolean(),
});
const Availability = z.object({ ready: z.boolean(), message: z.string().nullable() });
const Acknowledgement = z.object({
  frequency: z.enum(AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES),
  required: z.boolean(),
  text: z.string(),
  textHash: z.string(),
});
const Form = z.object({
  pair: Pair,
  fields: z.array(AutoDocFieldRow),
  entities: z.array(z.object({ id: z.string(), name: z.string() })),
});

async function ownedGeneration(
  db: Executor,
  user: AuthenticatedUser,
  id: string,
  generationId: string,
) {
  const [row] = await generationQuery(db, user).where(
    and(
      eq(autoDocGenerations.id, generationId),
      eq(autoDocGenerations.autoDocId, id),
      eq(autoDocGenerations.generatedBy, user.id),
      portalAutoDocScope(user),
    ),
  );
  if (!row) throw httpError(404, "This Generation is not available to you.");
  return row;
}

export const portalAutoDocRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/auto-docs",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalAutoDocs",
        tags: ["portal"],
        response: {
          200: z.object({ autoDocs: z.array(AutoDoc.extend({ availability: Availability })) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await app.db
        .select()
        .from(autoDocs)
        .where(and(eq(autoDocs.state, "published"), portalAutoDocScope(request.user)))
        .orderBy(asc(autoDocs.name), asc(autoDocs.id));
      const warnings =
        request.user.role === "business_user"
          ? await portalWarningsFor(app.db, rows)
          : new Map<string, string[]>();
      return {
        autoDocs: rows.map((row) => {
          const ready = !warnings.get(row.id)?.length;
          return {
            ...row,
            createsContract: row.targetContractTypeId !== null,
            availability: { ready, message: ready ? null : PORTAL_UNAVAILABLE },
          };
        }),
      };
    },
  );

  app.get(
    "/portal/auto-docs/:id/generate",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getPortalAutoDocForm",
        tags: ["portal"],
        params: Params,
        querystring: z.object({ acknowledgementId: z.uuid().optional() }),
        response: {
          200: z.object({
            autoDoc: AutoDoc,
            acknowledgement: Acknowledgement,
            availability: Availability,
            form: Form.nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        await lockPortalPerson(tx, request.user);
        const row = await readPortalAutoDoc(tx, request.user, request.params.id, true, true);
        const acknowledgement = await acknowledgementState(
          tx,
          request.user,
          row,
          request.query.acknowledgementId,
          true,
        );
        const ready =
          request.user.role !== "business_user" || !(await portalWarnings(tx, row)).length;
        const base = {
          autoDoc: { ...row, createsContract: row.targetContractTypeId !== null },
          acknowledgement,
          availability: { ready, message: ready ? null : PORTAL_UNAVAILABLE },
        };
        if (acknowledgement.required || !ready) return { ...base, form: null };
        const live = await livePair(tx, row.id);
        const definition = generationDefinition(row, live.form.definition);
        const fixed = row.targetContractTypeId && row.fixedEntityId;
        const fields = definition.fields
          .filter((field) => !fixed || field.fieldType !== "entity")
          .map((field) => ({
            ...field,
            catalogFieldId: field.catalogFieldId ?? null,
            contractAttribute: field.contractAttribute ?? null,
          }));
        const choices = fields.some((field) => field.fieldType === "entity")
          ? await listPortalEntities(tx)
          : [];
        return { ...base, form: { pair: live.pair, fields, entities: choices } };
      }),
  );

  app.post(
    "/portal/auto-docs/:id/acknowledgements",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "acknowledgePortalAutoDoc",
        tags: ["portal"],
        params: Params,
        body: z.strictObject({ textHash: z.string().regex(/^[a-f0-9]{64}$/) }),
        response: {
          201: z.object({ acknowledgementId: z.string().nullable() }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const acknowledgementId = await app.db.transaction(async (tx) => {
        await lockPortalPerson(tx, request.user);
        const row = await readPortalAutoDoc(tx, request.user, request.params.id, true, true);
        return acceptAcknowledgement(tx, request.user, row, request.body.textHash);
      });
      return reply.code(201).send({ acknowledgementId });
    },
  );

  app.post(
    "/portal/auto-docs/:id/generations",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "generatePortalAutoDoc",
        tags: ["portal"],
        params: Params,
        body: Pair.extend({
          answers: z.record(z.string().regex(AUTO_DOC_SLUG), Value.nullable()),
          acknowledgementId: z.uuid().optional(),
        }).strict(),
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const generation = await generateAutoDoc(
        app,
        request.log,
        request.user,
        request.params.id,
        request.body,
        (tx) =>
          authorisePortalGeneration(
            tx,
            request.user,
            request.params.id,
            request.body.acknowledgementId,
          ),
      );
      return reply.code(201).send({
        generation: toGeneration(
          await ownedGeneration(app.db, request.user, request.params.id, generation.id),
        ),
      });
    },
  );

  // ADO-010 retains owned history after Unpublish and Archive; audience changes still take effect.
  app.get(
    "/portal/auto-doc-generations",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalAutoDocGenerations",
        tags: ["portal"],
        querystring: z.object({ before: z.uuid().optional() }),
        response: {
          200: z.object({ generations: z.array(GenerationRow), nextCursor: z.string().nullable() }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await generationQuery(app.db, request.user)
        .where(
          and(
            eq(autoDocGenerations.generatedBy, request.user.id),
            portalAutoDocScope(request.user),
            request.query.before ? lt(autoDocGenerations.id, request.query.before) : undefined,
          ),
        )
        .orderBy(desc(autoDocGenerations.id))
        .limit(51);
      const page = rows.slice(0, 50);
      return {
        generations: page.map(toGeneration),
        nextCursor: rows.length > 50 ? page.at(-1)!.generation.id : null,
      };
    },
  );
  app.get(
    "/portal/auto-docs/:id/generations/:generationId",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getPortalAutoDocGeneration",
        tags: ["portal"],
        params: GenerationParams,
        response: { 200: Envelope.extend({ canGenerate: z.boolean() }), default: problemResponse },
      },
    },
    async (request) => {
      const row = await ownedGeneration(
        app.db,
        request.user,
        request.params.id,
        request.params.generationId,
      );
      const autoDoc = await readPortalAutoDoc(app.db, request.user, request.params.id, false);
      return {
        generation: toGeneration(row),
        canGenerate:
          autoDoc.state === "published" &&
          (request.user.role !== "business_user" ||
            !(await portalWarnings(app.db, autoDoc)).length),
      };
    },
  );
  for (const format of ["docx", "pdf"] as const)
    app.get(
      `/portal/auto-docs/:id/generations/:generationId/${format}`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: `downloadPortalAutoDoc${format === "docx" ? "Word" : "Pdf"}`,
          tags: ["portal"],
          params: GenerationParams,
          response: {
            200: z.any().meta({ type: "string", format: "binary" }),
            default: problemResponse,
          },
        },
      },
      async (request, reply) =>
        downloadGeneration(
          app,
          reply,
          await ownedGeneration(
            app.db,
            request.user,
            request.params.id,
            request.params.generationId,
          ),
          format,
        ),
    );
};
