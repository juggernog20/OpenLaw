// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  and,
  asc,
  autoDocGenerations,
  entities,
  eq,
  isNull,
  lt,
  desc,
  type Transaction,
} from "@openlaw/db";
import type { FastifyBaseLogger } from "fastify";
import type { AppDeps } from "../app.js";
import type { AuthenticatedUser } from "../auth/guards.js";
import { AUTO_DOC_SLUG } from "../lib/auto-doc-template.js";
import { entityReachScope } from "../lib/entity-access.js";
import { listPortalEntities } from "../lib/portal-entities.js";
import { HttpError, httpError } from "../lib/problem.js";
import { generationDefinition } from "../modules/auto-docs/contract-destination.js";
import { generationReachScope } from "../modules/auto-docs/generation-access.js";
import {
  generateAutoDoc,
  GenerationRow,
  generationQuery,
  livePair,
  Pair,
  toGeneration,
  Value,
  type GenerationSubmission,
} from "../modules/auto-docs/generations.js";
import {
  ACKNOWLEDGEMENT_REQUIRED,
  acknowledgementState,
  authorisePortalGeneration,
  lockPortalPerson,
  portalAutoDocScope,
  portalWarnings,
  PORTAL_UNAVAILABLE,
  readPortalAutoDoc,
} from "../modules/auto-docs/portal-policy.js";
import { AutoDocFieldRow } from "../modules/auto-docs/routes.js";
import { listAutoDocs, listPortalAutoDocs } from "../modules/auto-docs/service.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { ToolError, type ToolDefinition } from "./tool.js";
import { readTool, writeTool } from "./workspace.js";

export const AutoDocFormOutput = z.object({
  pair: Pair,
  fields: z.array(AutoDocFieldRow),
  entities: z.array(z.object({ id: z.string(), name: z.string() })),
});
const generationOutput = GenerationRow.extend({
  downloads: z.object({ docx: z.string().nullable(), pdf: z.string().nullable() }),
});
const listInput = z.object({ ...pageInput, cursor: z.uuid().optional() }).strict();
const generateInput = Pair.extend({
  id: z.uuid(),
  answers: z.record(z.string().regex(AUTO_DOC_SLUG), Value.nullable()),
}).strict();

/**
 * ADO-008 belongs to the Portal. A once or once-per-Auto-Doc acknowledgement
 * given there stands for later Tool calls; an every-use one is consumed by
 * the Portal Generation it precedes, so that schedule sends the whole
 * Generation to the Portal.
 */
function acknowledgementRefusal(id: string, baseUrl: string, frequency: unknown) {
  const page = new URL(`/portal/auto-docs/${id}/generate`, baseUrl).href;
  return new ToolError(
    "acknowledgement_required",
    frequency === "every_use"
      ? `Your organisation asks for an acknowledgement at every use, so generate this Auto-Doc in the Portal at ${page}. Your answers have not been submitted.`
      : `Acknowledge the current text in the Portal at ${page} before generating. Your answers have not been submitted.`,
  );
}
export async function readAutoDocForm(
  tx: Transaction,
  user: AuthenticatedUser,
  id: string,
  baseUrl: string,
) {
  await lockPortalPerson(tx, user);
  const row = await readPortalAutoDoc(tx, user, id, true, true);
  const acknowledgement = await acknowledgementState(tx, user, row, undefined, true);
  if (acknowledgement.required)
    throw acknowledgementRefusal(id, baseUrl, acknowledgement.frequency);
  if (user.role === "business_user" && (await portalWarnings(tx, row)).length)
    throw httpError(409, PORTAL_UNAVAILABLE);
  const live = await livePair(tx, id);
  const definition = generationDefinition(row, live.form.definition);
  const fixed = row.targetContractTypeId && row.fixedEntityId;
  const fields = definition.fields
    .filter((field) => !fixed || field.fieldType !== "entity")
    .map((field) => ({
      ...field,
      catalogFieldId: field.catalogFieldId ?? null,
      contractAttribute: field.contractAttribute ?? null,
    }));
  const choices = !fields.some((field) => field.fieldType === "entity")
    ? []
    : user.role === "business_user"
      ? await listPortalEntities(tx, user)
      : await tx
          .select({ id: entities.id, name: entities.legalName })
          .from(entities)
          .where(and(isNull(entities.archivedAt), entityReachScope(tx, user)))
          .orderBy(asc(entities.legalName));
  return bounded(AutoDocFormOutput.parse({ pair: live.pair, fields, entities: choices }));
}

export async function generateForTool(
  app: Pick<AppDeps, "db" | "storage" | "fillEngine" | "jobs" | "notifier" | "maxUploadBytes">,
  log: FastifyBaseLogger,
  user: AuthenticatedUser,
  id: string,
  submission: GenerationSubmission,
  baseUrl: string,
) {
  try {
    return await generateAutoDoc(app, log, user, id, submission, (tx) =>
      authorisePortalGeneration(tx, user, id),
    );
  } catch (error) {
    if (error instanceof HttpError && error.type === ACKNOWLEDGEMENT_REQUIRED)
      throw acknowledgementRefusal(id, baseUrl, error.extensions?.frequency);
    if (error instanceof HttpError && error.statusCode === 429)
      throw new ToolError("generation_limit_reached", error.message);
    throw error;
  }
}
function withDownloads(value: unknown, user: AuthenticatedUser, baseUrl: string) {
  // Project the UI response before returning it; snapshots and storage references stay private.
  const generation = GenerationRow.parse(value);
  const path = `/api/v1${user.role === "business_user" ? "/portal" : ""}/auto-docs/${generation.autoDocId}/generations/${generation.id}`;
  return {
    ...generation,
    downloads: {
      docx:
        generation.hasDocx && generation.formats !== "pdf"
          ? new URL(`${path}/docx`, baseUrl).href
          : null,
      pdf:
        generation.hasPdf && generation.formats !== "docx"
          ? new URL(`${path}/pdf`, baseUrl).href
          : null,
    },
  };
}
export const autoDocTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "auto-docs",
    name: "openlaw_auto_docs_list",
    title: "List Auto-Docs",
    description:
      "List Auto-Docs within your reach. Business Users see published Portal Auto-Docs with availability. Legal Users see the staff list, excluding archived Auto-Docs. Read a form with openlaw_form_get, kind auto_doc and typeId set to its id. Continue with nextCursor.",
    inputSchema: listInput,
    outputSchema: z.object({
      autoDocs: z.array(z.record(z.string(), z.unknown())),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { cursor, limit } = listInput.parse(input);
        const { autoDocs } =
          user.role === "business_user"
            ? await listPortalAutoDocs(db, user)
            : await listAutoDocs(db, user);
        const index = cursor ? autoDocs.findIndex((row) => row.id === cursor) : -1;
        const page = boundedPage<Record<string, unknown> & { id: string }>(
          cursor && index < 0 ? [] : autoDocs.slice(index + 1),
          limit,
          (row) => row.id,
        );
        return bounded({ autoDocs: page.items, nextCursor: page.nextCursor });
      }),
  },
  {
    ...writeTool,
    businessUser: "on",
    toolset: "auto-docs",
    name: "openlaw_auto_doc_generate",
    title: "Generate an Auto-Doc",
    description:
      "Submit answers keyed by Form field slug for an Auto-Doc id. First read openlaw_form_get with kind auto_doc and typeId set to the id; submit its documentVersionId and formVersionId unchanged. Ask the person for missing answers with your question tool. Creates a Generation under the UI caps. An owed acknowledgement requires the person to visit the Portal. Download links require their signed-in browser; files are never returned here.",
    inputSchema: generateInput,
    outputSchema: z.object({ generation: generationOutput }),
    run: async (input, context) =>
      serviceResult(async () => {
        const { id, ...submission } = generateInput.parse(input);
        if (!context.generateAutoDoc)
          throw new ToolError("unavailable", "Auto-Doc Generation is not available.");
        return bounded({
          generation: withDownloads(
            await context.generateAutoDoc(id, submission),
            context.user,
            context.baseUrl,
          ),
        });
      }),
  },
  {
    ...readTool,
    toolset: "auto-docs",
    name: "openlaw_generations_list",
    title: "List your Generations",
    description:
      "List your own Generations, newest first, with state and available download links. Current reach still applies; history survives Unpublish and Archive. Continue with nextCursor. Open download links in your signed-in browser. The Tool never carries a file.",
    inputSchema: listInput,
    outputSchema: z.object({
      generations: z.array(generationOutput),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user, baseUrl }) =>
      serviceResult(async () => {
        const { cursor, limit } = listInput.parse(input);
        const scope = and(
          eq(autoDocGenerations.generatedBy, user.id),
          portalAutoDocScope(user),
          generationReachScope(db, user),
        );
        if (cursor) {
          const [boundary] = await generationQuery(db, user)
            .where(and(scope, eq(autoDocGenerations.id, cursor)))
            .limit(1);
          if (!boundary) return { generations: [], nextCursor: null };
        }
        const rows = await generationQuery(db, user)
          .where(and(scope, cursor ? lt(autoDocGenerations.id, cursor) : undefined))
          .orderBy(desc(autoDocGenerations.id))
          .limit(limit + 1);
        const page = boundedPage(
          rows.map((row) => withDownloads(toGeneration(row), user, baseUrl)),
          limit,
          (row) => row.id,
        );
        return bounded({ generations: page.items, nextCursor: page.nextCursor });
      }),
  },
];
