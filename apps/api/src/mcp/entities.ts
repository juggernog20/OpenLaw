// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { listEntities, getEntity, EntityListQuery } from "../modules/entities/service.js";
import { listPortalEntities } from "../lib/portal-entities.js";
import { listEntityOfficers } from "../modules/entities/record-routes.js";
import { listEntityObligations } from "../modules/entities/obligation-routes.js";
import { getEntityShareRegister } from "../modules/entities/share-register-routes.js";
import { listEntityDocuments } from "../modules/documents/service.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { readTool, recordOutput } from "./documents.js";
import { ToolError, type ToolDefinition } from "./tool.js";
const listInput = EntityListQuery.pick({ q: true, type: true, jurisdiction: true }).extend({
  ...pageInput,
  cursor: z.string().min(1).max(64).optional(),
});
const getInput = z.object({
  id: z.string().uuid(),
  ...pageInput,
  cursor: z.string().min(1).max(64).optional(),
});
export const entityTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "entities",
    name: "openlaw_entities_list",
    title: "List Entities",
    description:
      "List reached Entities. Business Users get only the names of Portal-listed Entities, with optional q text. type and jurisdiction filters require a Legal User. Continue with nextCursor and unchanged filters.",
    inputSchema: listInput,
    outputSchema: z.object({ entities: z.array(recordOutput), nextCursor: z.string().nullable() }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const args = listInput.parse(input);
        let result;
        if (user.role === "business_user") {
          if (args.type || args.jurisdiction)
            throw new ToolError(
              "forbidden",
              "Entity type and jurisdiction filters require a Legal User.",
            );
          const all = (await listPortalEntities(db, user)).filter(
            (e) => !args.q || e.name.toLowerCase().includes(args.q.toLowerCase()),
          );
          const index = args.cursor ? all.findIndex((e) => e.id === args.cursor) : -1;
          result = {
            entities: args.cursor && index < 0 ? [] : all.slice(index + 1),
            nextCursor: null,
          };
        } else result = await listEntities(db, user, args);
        const page = boundedPage<Record<string, unknown> & { id: string }>(
          result.entities,
          args.limit,
          (e) => e.id,
          result.nextCursor,
        );
        return bounded({ entities: page.items, nextCursor: page.nextCursor });
      }),
  },
  {
    ...readTool,
    businessUser: "off",
    toolset: "entities",
    name: "openlaw_entity_get",
    title: "Read an Entity",
    description:
      "Read one reached Entity with its current Officers, statutory Documents, compliance Obligations and share register summary. Legal Users only. Continue the Documents with nextCursor or openlaw_documents_list. limit bounds the Documents page.",
    inputSchema: getInput,
    outputSchema: z.object({
      entity: recordOutput,
      officers: z.array(recordOutput),
      documents: z.array(recordOutput),
      obligations: z.array(recordOutput),
      shareRegister: recordOutput,
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const args = getInput.parse(input);
        const detail = await getEntity(db, user, args.id);
        const [officers, paper, obligations, register] = await Promise.all([
          listEntityOfficers(db, user, args.id),
          listEntityDocuments(db, user, args.id, { cursor: args.cursor }),
          listEntityObligations(db, user, args.id),
          getEntityShareRegister(db, user, args.id),
        ]);
        const page = boundedPage(paper.documents, args.limit, (d) => d.id, paper.nextCursor);
        return bounded({
          entity: detail.entity,
          officers: officers.officers,
          documents: page.items,
          obligations: obligations.obligations,
          shareRegister: {
            asOf: register.asOf,
            totals: register.totals,
            reconciliation: register.reconciliation,
          },
          nextCursor: page.nextCursor,
        });
      }),
  },
];
