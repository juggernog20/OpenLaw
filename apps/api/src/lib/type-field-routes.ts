// SPDX-License-Identifier: AGPL-3.0-only
/** Type Forms own writes; existing record readers can list attached Fields. */
import type { FormModule } from "@openlaw/shared";
import { typeFormRoutes } from "./type-form-routes.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  fields,
  FIELD_TYPES,
  isNull,
  type Executor,
  type Field,
  type FieldModuleScope,
} from "@openlaw/db";
import { requireRole } from "../auth/guards.js";
import type { TypeFieldActionPrefix } from "./activity.js";
import { httpError, problemResponse } from "./problem.js";
import type { TaxonomyTable } from "./taxonomy-routes.js";
import type { TypeFieldsTable } from "./type-fields.js";
export type TypeFieldRow = TypeFieldsTable["$inferSelect"];
export interface TypeFieldScopeRule {
  scopes: readonly [FieldModuleScope, ...FieldModuleScope[]];
  refusal: string;
}
export interface TypeFieldRoutesConfig {
  formModule: FormModule;
  typesTable: TaxonomyTable;
  joinTable: TypeFieldsTable;
  path: string;
  tag: string;
  idInfix: string;
  noun: string;
  scopeRule: TypeFieldScopeRule;
  actionPrefix: TypeFieldActionPrefix;
}
export function typeFieldRoutes(config: TypeFieldRoutesConfig): FastifyPluginAsyncZod {
  const { typesTable, joinTable, path, noun } = config;
  const AttachedFieldSchema = z.object({
    fieldId: z.string(),
    slug: z.string(),
    displayName: z.string(),
    fieldType: z.enum(FIELD_TYPES),
    moduleScope: z.enum(config.scopeRule.scopes),
    displayOrder: z.number().int(),
    isRequired: z.boolean(),
    visibleOnPortal: z.boolean(),
  });
  const AttachedFieldListEnvelope = z.object({ attachedFields: z.array(AttachedFieldSchema) });
  function toRow(join: TypeFieldRow, field: Field) {
    return {
      fieldId: field.id,
      slug: field.slug,
      displayName: field.displayName,
      fieldType: field.fieldType,
      moduleScope: field.moduleScope,
      displayOrder: join.displayOrder,
      isRequired: join.isRequired,
      visibleOnPortal: "visibleOnPortal" in join ? join.visibleOnPortal : true,
    };
  }

  return async (app) => {
    await app.register(typeFormRoutes(config, config.formModule));
    function liveAttachments(dbOrTx: Executor, typeId: string) {
      return dbOrTx
        .select({ join: joinTable, field: fields })
        .from(joinTable)
        .innerJoin(fields, eq(joinTable.fieldId, fields.id))
        .where(and(eq(joinTable.typeId, typeId), isNull(fields.archivedAt)))
        .orderBy(asc(joinTable.displayOrder), asc(joinTable.createdAt));
    }
    app.get(
      `/${path}/:id/fields`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `list${config.idInfix}Fields`,
          summary:
            `One ${noun}'s attached fields in per-type order ` +
            "— the type editor's Attached fields card",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          response: { 200: AttachedFieldListEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const [type] = await app.db
          .select({ id: typesTable.id })
          .from(typesTable)
          .where(eq(typesTable.id, request.params.id))
          .limit(1);
        if (!type) throw httpError(404, `No ${noun} exists with this id.`);
        const rows = await liveAttachments(app.db, type.id);
        return { attachedFields: rows.map(({ join, field }) => toRow(join, field)) };
      },
    );
  };
}
