// SPDX-License-Identifier: AGPL-3.0-only

/** Request types keep their identity, turnaround and destination. A destination
names a module and may name a type; module-only Requests use its Default Form. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  contractTypes,
  eq,
  isNull,
  matterTypes,
  ne,
  or,
  requestTypes,
  type Executor,
  type RequestType,
} from "@openlaw/db";
import { type ChangedFields } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { requestTypeUsage } from "../requests/type-usage.js";
import { insertTypeCopy, lockTypeIdentities, taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { TARGET_MODULES, type TargetModule } from "./form-definition.js";

const TargetModuleSchema = z.enum(TARGET_MODULES);

const TARGET_TABLES = { matter: matterTypes, contract: contractTypes } as const;

function targetTypeId(row: RequestType): string | null {
  return row.targetContractTypeId ?? row.targetMatterTypeId;
}

/**
 * The target type as an Administrator names it, for the `updated`
 * payload. A deleted type has already demoted the row to module-only
 * (`on delete set null`), so the miss below is only ever a row read in
 * the same breath as its deletion.
 */
async function targetTypeName(
  tx: Executor,
  module: TargetModule,
  id: string,
): Promise<string | null> {
  const table = TARGET_TABLES[module];
  const [row] = await tx
    .select({ displayName: table.displayName })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return row?.displayName ?? null;
}

const requestTypeTaxonomy = taxonomyRoutes({
  table: requestTypes,
  path: "request-types",
  tag: "request-types",
  idSingular: "RequestType",
  idPlural: "RequestTypes",
  keySingular: "requestType",
  keyPlural: "requestTypes",
  noun: "request type",
  decision: "INT-002",
  actionPrefix: "request_type",
  usage: requestTypeUsage,
  recordNoun: { singular: "request", plural: "requests" },
  extras: {
    rowSchema: {
      turnaroundDays: z.number().int().nullable(),
      targetModule: TargetModuleSchema,
      targetTypeId: z.string().nullable(),
    },
    projectRow: (row) => {
      const type = row as RequestType;
      return {
        turnaroundDays: type.turnaroundDays,
        targetModule: type.targetModule,
        targetTypeId: targetTypeId(type),
      };
    },
    patchSchema: {
      turnaroundDays: z.number().int().min(0).max(36500).nullable().optional(),
      targetModule: TargetModuleSchema.nullable().optional(),
      targetTypeId: z.string().nullable().optional(),
    },
    applyPatch: async ({ tx, row, body }) => {
      const namesModule = body.targetModule !== undefined;
      const namesType = body.targetTypeId !== undefined;
      const current = row as RequestType;
      const columns: Partial<RequestType> = {};
      const changed: ChangedFields = {};
      if (body.turnaroundDays !== undefined && body.turnaroundDays !== current.turnaroundDays) {
        columns.turnaroundDays = body.turnaroundDays;
        changed.turnaroundDays = { from: current.turnaroundDays, to: body.turnaroundDays };
      }
      if (!namesModule && !namesType) return { columns, changed };
      const currentModule = current.targetModule;
      const currentTypeId = targetTypeId(current);
      // The two keys are one value: a body that names the module says
      // the whole target, so an id it leaves out means "the module
      // alone" rather than "keep the old one".
      const module = namesModule ? (body.targetModule ?? null) : currentModule;
      const typeId = namesType ? (body.targetTypeId ?? null) : namesModule ? null : currentTypeId;

      if (module === null)
        throw httpError(400, "A Request type needs a destination module. Pick Matter or Contract.");

      if (typeId !== null) {
        const table = TARGET_TABLES[module];
        const [candidate] = await tx
          .select({ id: table.id, archivedAt: table.archivedAt })
          .from(table)
          .where(eq(table.id, typeId))
          .limit(1);
        // One refusal for three misses — no such row, an archived row,
        // and a live row of the other module's table. Naming which
        // would tell a caller what exists in a taxonomy this request
        // did not ask about.
        if (!candidate || candidate.archivedAt) {
          throw httpError(400, `The target must be a live ${module} type.`);
        }
      }

      if (module === currentModule && typeId === currentTypeId) return { columns, changed };

      if (module !== currentModule) {
        changed.targetModule = { from: currentModule, to: module };
      }
      if (typeId !== currentTypeId) {
        changed.targetType = {
          // Names, not ids: the log is read by a person, and what the
          // type was called when the change was made is the truth an
          // audit trail keeps.
          from:
            currentTypeId !== null && currentModule !== null
              ? await targetTypeName(tx, currentModule, currentTypeId)
              : null,
          to: typeId !== null ? await targetTypeName(tx, module, typeId) : null,
        };
      }

      return {
        columns: {
          ...columns,
          targetModule: module,
          targetMatterTypeId: module === "matter" ? typeId : null,
          targetContractTypeId: module === "contract" ? typeId : null,
        },
        changed,
      };
    },
  },
});

const SeparateFormEnvelope = z.object({
  requestType: z.object({
    id: z.string(),
    targetModule: TargetModuleSchema,
    targetTypeId: z.string(),
  }),
  type: z.object({ id: z.string(), slug: z.string(), displayName: z.string() }),
});

/**
 * The taxonomy routes, plus one action of a Request type's own: give it
 * its own Form (DD-028, 2026-10-02 line in the 2026-09-30 amendment).
 * Several Request types may share one destination type, and an edit to
 * that Form changes every one of them. This copies the destination type
 * and its Form, names the copy after the Request type, and points this
 * Request type at the copy, all in one transaction. The other Request
 * types keep their destination.
 */
export const requestTypesRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(requestTypeTaxonomy);

  app.post(
    "/request-types/:id/separate-form",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "separateRequestTypeForm",
        summary:
          "Give a Request type that shares its destination Form a Form of its own: copy the " +
          "destination type with its Form, name the copy after the Request type, and point " +
          "the Request type at the copy (DD-028)",
        tags: ["request-types"],
        params: z.object({ id: z.string() }),
        response: { 201: SeparateFormEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const result = await app.db.transaction(async (tx) => {
        const [requestType] = await tx
          .select()
          .from(requestTypes)
          .where(eq(requestTypes.id, request.params.id))
          .limit(1)
          .for("update");
        if (!requestType) throw httpError(404, "No request type exists with this id.");
        if (requestType.archivedAt)
          throw httpError(409, "Restore this request type before you give it its own Form.");
        const module = requestType.targetModule;
        const table = TARGET_TABLES[module];
        const column =
          module === "contract"
            ? requestTypes.targetContractTypeId
            : requestTypes.targetMatterTypeId;
        const existing = await lockTypeIdentities(tx, table, `${module}-types`);
        const currentTypeId = targetTypeId(requestType);
        // A module-only destination lands on the module's Default type.
        const isDefault = (row: (typeof existing)[number]) =>
          (row as { isDefault?: boolean }).isDefault === true;
        const source = existing.find((row) =>
          currentTypeId === null ? isDefault(row) : row.id === currentTypeId,
        );
        if (!source || source.archivedAt)
          throw httpError(409, `The destination must be a live ${module} type.`);
        // The rule the Intake form card and the preview use to name the
        // Request types that share a Form.
        const [sharer] = await tx
          .select({ id: requestTypes.id })
          .from(requestTypes)
          .where(
            and(
              ne(requestTypes.id, requestType.id),
              isNull(requestTypes.archivedAt),
              eq(requestTypes.targetModule, module),
              or(eq(column, source.id), isDefault(source) ? isNull(column) : undefined),
            ),
          )
          .limit(1);
        if (!sharer) throw httpError(409, "This request type already has its own Form.");

        const copy = await insertTypeCopy(tx, {
          table,
          module,
          source,
          existing,
          displayName: requestType.displayName,
          actorId: request.user.id,
          columns: { isDefault: false },
        });
        await tx
          .update(requestTypes)
          .set({
            targetMatterTypeId: module === "matter" ? copy.id : null,
            targetContractTypeId: module === "contract" ? copy.id : null,
          })
          .where(eq(requestTypes.id, requestType.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "request_type.updated",
          visibility: "admin_only",
          payload: {
            slug: requestType.slug,
            changed: {
              targetType: {
                from: currentTypeId === null ? null : source.displayName,
                to: copy.displayName,
              },
            },
          },
        });
        return {
          requestType: { id: requestType.id, targetModule: module, targetTypeId: copy.id },
          type: { id: copy.id, slug: copy.slug, displayName: copy.displayName },
        };
      });
      return reply.status(201).send(result);
    },
  );
};
