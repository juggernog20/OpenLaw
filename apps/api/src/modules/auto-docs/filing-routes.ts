// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005 and DD-024: Filing history, destination choices, and writes under each shell's reach rules. */
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, asc, isNull, ilike, contracts, matters, contractTypes } from "@openlaw/db";
import { requireAuth, requireRole } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { matterTeamScope } from "../../lib/matter-access.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { problemResponse } from "../../lib/problem.js";
import { FilingInput, FilingRow, FilingTarget } from "./filing-schema.js";
import { fileGeneration, filingSource, listFilings } from "./filings.js";

export const autoDocFilingRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const portal of [false, true]) {
    const prefix = portal ? "/portal/auto-docs" : "/auto-docs";
    const preHandler = portal ? requireAuth : requireRole("administrator", "legal_team_member");
    app.get(
      `${prefix}/filing-options`,
      {
        preHandler,
        schema: {
          tags: ["Auto-Docs"],
          operationId: portal ? "listPortalAutoDocFilingOptions" : "listAutoDocFilingOptions",
          summary: "Find reached live Filing destinations",
          querystring: z.object({ search: z.string().max(200).optional() }),
          response: {
            200: z.object({
              destinations: z.array(FilingTarget),
              contractTypes: z.array(z.object({ id: z.string(), name: z.string() })),
            }),
            default: problemResponse,
          },
        },
      },
      async (request) => {
        const rows = [];
        for (const kind of ["contract", "matter"] as const) {
          const table = kind === "contract" ? contracts : matters;
          const scope = portal
            ? portalRecordScope(app.db, request.user, kind)
            : kind === "contract"
              ? contractTeamScope(app.db, request.user)
              : matterTeamScope(app.db, request.user);
          const records = await app.db
            .select({ number: table.number, title: table.title })
            .from(table)
            .where(
              and(
                scope,
                isNull(table.archivedAt),
                request.query.search
                  ? ilike(table.title, `%${request.query.search.replace(/[\\%_]/g, "\\$&")}%`)
                  : undefined,
              ),
            )
            .orderBy(asc(table.title), asc(table.number))
            .limit(50);
          rows.push(...records.map((row) => ({ kind, ...row })));
        }
        return {
          destinations: rows,
          contractTypes: portal
            ? []
            : await app.db
                .select({ id: contractTypes.id, name: contractTypes.displayName })
                .from(contractTypes)
                .where(isNull(contractTypes.archivedAt))
                .orderBy(asc(contractTypes.displayName)),
        };
      },
    );
    const path = `${prefix}/:id/generations/:generationId/filings`;
    const params = z.object({ id: z.string(), generationId: z.string() });
    app.get(
      path,
      {
        preHandler,
        schema: {
          tags: ["Auto-Docs"],
          operationId: portal ? "listPortalAutoDocFilings" : "listAutoDocFilings",
          summary: "List a Generation's Filings",
          params,
          response: { 200: z.object({ filings: z.array(FilingRow) }), default: problemResponse },
        },
      },
      async (request) => {
        await filingSource(
          app.db,
          request.user,
          request.params.id,
          request.params.generationId,
          portal,
        );
        return {
          filings: await listFilings(app.db, request.user, request.params.generationId, portal),
        };
      },
    );
    app.post(
      path,
      {
        preHandler,
        schema: {
          tags: ["Auto-Docs"],
          operationId: portal ? "filePortalAutoDocGeneration" : "fileAutoDocGeneration",
          summary: "File a Generation as a new Document",
          params,
          body: FilingInput,
          response: { 201: z.object({ filing: FilingRow }), default: problemResponse },
        },
      },
      async (request, reply) =>
        reply.code(201).send({
          filing: (await fileGeneration(
            app,
            request.log,
            request.user,
            request.params.id,
            request.params.generationId,
            request.body,
            portal,
          ))!,
        }),
    );
  }
};
