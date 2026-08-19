// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request-type taxonomy routes (INT-002, #85): the shared taxonomy
 * machinery (`taxonomyRoutes`) mounted on `request_types` with the
 * INT-002 vocabulary — the fourth mount, and the point of #85 is that
 * this file is configuration, not a copy. Every mutation is
 * Administrator-only and audit-logged (DD-017) — see the factory for
 * the behavior set.
 *
 * **No protected slug.** There is no fallback request type: no record
 * needs a non-null request type once conversion is done, so nothing has
 * to survive an Administrator's tidy-up. A row someone names "Other"
 * archives and deletes like any other row.
 *
 * **The target is this mount's extras.** A request type targets
 * nothing, the Matter module, or the Contract module — and inside
 * Matter or Contract it may name one specific type. On the wire that is
 * two values: `targetModule` and the optional `targetTypeId`. The table
 * holds three columns, one per module plus the module itself; which
 * table an id names is the module's to say, so the projection collapses
 * the two id columns into one and the validator routes a written id
 * back to its own column.
 *
 * The two keys are **one value**. Naming the module rewrites the target
 * whole — a type id absent from the body means the module-only state,
 * so a stale id from the other module can never survive a re-point.
 * Naming only the type id leaves the module alone and the id must fit
 * it. Both refusals are RFC 9457 problems, decided under the row lock
 * the machinery already holds; the check constraint holds the same
 * invariant at the table, for the writes no route makes.
 *
 * In-use counts read zero until `requests` exists in M20, exactly as
 * matter types read zero until M22.
 */

import { z } from "zod";
import {
  contractTypes,
  eq,
  matterTypes,
  requestTypes,
  type Executor,
  type RequestType,
} from "@openlaw/db";
import type { ChangedFields } from "@openlaw/shared";
import { httpError } from "../../lib/problem.js";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";

/** The two modules a request type may convert into (INT-002). */
const TargetModuleSchema = z.enum(["matter", "contract"]);
type TargetModule = z.infer<typeof TargetModuleSchema>;

/** The taxonomy a module's target type comes from. */
const TARGET_TABLES = { matter: matterTypes, contract: contractTypes } as const;

/** The one type id the row holds, whichever column holds it. */
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
  recordsMilestone: "M20",
  recordNoun: { singular: "request", plural: "requests" },
  extras: {
    rowSchema: {
      targetModule: TargetModuleSchema.nullable(),
      targetTypeId: z.string().nullable(),
    },
    projectRow: (row) => {
      const type = row as RequestType;
      return {
        targetModule: type.targetModule as TargetModule | null,
        targetTypeId: targetTypeId(type),
      };
    },
    patchSchema: {
      targetModule: TargetModuleSchema.nullable().optional(),
      targetTypeId: z.string().nullable().optional(),
    },
    applyPatch: async ({ tx, row, body }) => {
      const namesModule = body.targetModule !== undefined;
      const namesType = body.targetTypeId !== undefined;
      if (!namesModule && !namesType) return {};

      const current = row as RequestType;
      const currentModule = current.targetModule as TargetModule | null;
      const currentTypeId = targetTypeId(current);
      // The two keys are one value: a body that names the module says
      // the whole target, so an id it leaves out means "the module
      // alone" rather than "keep the old one".
      const module = namesModule ? (body.targetModule ?? null) : currentModule;
      const typeId = namesType ? (body.targetTypeId ?? null) : namesModule ? null : currentTypeId;

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

      if (module === currentModule && typeId === currentTypeId) return {};

      const changed: ChangedFields = {};
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
          targetModule: module,
          targetMatterTypeId: module === "matter" ? typeId : null,
          targetContractTypeId: module === "contract" ? typeId : null,
        },
        changed,
      };
    },
  },
});
