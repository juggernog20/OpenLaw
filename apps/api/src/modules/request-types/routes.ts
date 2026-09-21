// SPDX-License-Identifier: AGPL-3.0-only

/** Request types keep their identity, turnaround and destination. A destination
names a module and may name a type; module-only Requests use its Default Form. */

import { z } from "zod";
import {
  contractTypes,
  eq,
  matterTypes,
  requestTypes,
  type Executor,
  type RequestType,
} from "@openlaw/db";
import { type ChangedFields } from "@openlaw/shared";
import { httpError } from "../../lib/problem.js";
import { requestTypeUsage } from "../requests/type-usage.js";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { formFieldCounts, TARGET_MODULES, type TargetModule } from "./form-definition.js";

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

export const requestTypesRoutes = taxonomyRoutes({
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
      formFieldOrder: z.array(z.string()),
      turnaroundDays: z.number().int().nullable(),
      targetModule: TargetModuleSchema,
      targetTypeId: z.string().nullable(),
      /** ST12's Form fields column: how many catalog fields this type's
       * portal form collects, over and above the four fixed basics. */
      formFieldCount: z.number().int(),
    },
    // The count is not on the row, so it is read once over the whole
    // answer set rather than per row — see the hook.
    loadContext: (db, rows) =>
      formFieldCounts(
        db,
        rows.map((row) => row.id),
      ),
    projectRow: (row, counts) => {
      const type = row as RequestType;
      return {
        formFieldOrder: type.formFieldOrder,
        turnaroundDays: type.turnaroundDays,
        targetModule: type.targetModule,
        targetTypeId: targetTypeId(type),
        formFieldCount: counts.get(type.id) ?? 0,
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
        if (module === null) {
          throw httpError(
            400,
            "A target type needs a target module. Pick Matter or Contract first.",
          );
        }
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
          to: typeId !== null && module !== null ? await targetTypeName(tx, module, typeId) : null,
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
