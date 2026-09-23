// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DOC-015 Document types: three taxonomy mounts over one table, one per
 * owning module, plus the options read every uploader needs. Knowledge
 * has no mount: its files show their item's Knowledge type.
 *
 * A row with a system kind is fixed. The machinery's `isProtected`
 * refuses its archive and delete, and the extras refuse its rename and
 * description edit, because code reads the kind it stands for.
 *
 * Archive keeps references. A Version is a record of what somebody
 * called that round, so an archived type goes on labelling it and only
 * leaves the pickers. Reassigning would rewrite history.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  count,
  DOCUMENT_TYPE_MODULES,
  DOCUMENT_TYPE_SYSTEM_KINDS,
  documentTypes,
  documentVersions,
  eq,
  inArray,
  isNull,
  type DocumentTypeModule,
  type Executor,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { taxonomyRoutes, type TaxonomyRow, type TaxonomyUsage } from "../../lib/taxonomy-routes.js";

/** Every Version that names a type, archived Documents included. */
const documentTypeUsage: TaxonomyUsage = {
  async counts(db: Executor, ids: string[]) {
    const rows = await db
      .select({ typeId: documentVersions.documentTypeId, inUse: count() })
      .from(documentVersions)
      .where(inArray(documentVersions.documentTypeId, ids))
      .groupBy(documentVersions.documentTypeId);
    return new Map(rows.map((row) => [row.typeId!, row.inUse]));
  },
  reassign() {
    // `archiveKeepsReferences` refuses a reassignment target before the
    // machinery reaches this.
    throw new Error("Document types keep their references when archived.");
  },
};

const systemKindOf = (row: TaxonomyRow) =>
  (row as TaxonomyRow & { systemKind: string | null }).systemKind;

const MOUNTS = {
  matter: { id: "MatterDocumentType", ids: "MatterDocumentTypes" },
  contract: { id: "ContractDocumentType", ids: "ContractDocumentTypes" },
  entity: { id: "EntityDocumentType", ids: "EntityDocumentTypes" },
} as const satisfies Record<DocumentTypeModule, { id: string; ids: string }>;

function documentTypeMount(module: DocumentTypeModule) {
  return taxonomyRoutes({
    table: documentTypes,
    scope: { key: "module", value: module },
    path: `documents/types/${module}`,
    tag: "document-types",
    idSingular: MOUNTS[module].id,
    idPlural: MOUNTS[module].ids,
    keySingular: "documentType",
    keyPlural: "documentTypes",
    noun: "document type",
    decision: "DOC-015",
    actionPrefix: "document_type",
    recordNoun: { singular: "version", plural: "versions" },
    usage: documentTypeUsage,
    archiveKeepsReferences: true,
    isProtected: (row) => systemKindOf(row) !== null,
    extras: {
      rowSchema: { systemKind: z.enum(DOCUMENT_TYPE_SYSTEM_KINDS).nullable() },
      projectRow: (row) => ({
        systemKind: systemKindOf(row) as (typeof DOCUMENT_TYPE_SYSTEM_KINDS)[number] | null,
      }),
      applyPatch: ({ row, body }) => {
        if (
          systemKindOf(row) !== null &&
          (body.displayName !== undefined || body.description !== undefined)
        ) {
          throw httpError(409, `${row.displayName} is a fixed document type and can't be edited.`);
        }
        return {};
      },
    },
  });
}

export const documentTypesRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const module of DOCUMENT_TYPE_MODULES) {
    await app.register(documentTypeMount(module));
  }
};

const DocumentTypeOptionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  systemKind: z.enum(DOCUMENT_TYPE_SYSTEM_KINDS).nullable(),
});

/**
 * The live types of one module in display order, for every picker.
 * Every signed-in role reads the Matter and Contract lists, because a
 * Business User uploads to those records too. The Entity list is for
 * Administrators and Legal Team Members only: a Business User reaches no
 * Entity paper (ENT-004). The settings routes above stay
 * Administrator-only.
 */
export const documentTypeOptionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/documents/type-options",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listDocumentTypeOptions",
        summary:
          "One module's live Document types in display order, for upload and " +
          "correction pickers (DOC-015). Every role reads the matter and contract " +
          "lists; the entity list is for Administrators and Legal Team Members. " +
          "The settings list stays Administrator-only",
        tags: ["document-types"],
        querystring: z.object({ module: z.enum(DOCUMENT_TYPE_MODULES) }),
        response: {
          200: z.object({ documentTypes: z.array(DocumentTypeOptionSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      if (request.query.module === "entity" && request.user.role === "business_user") {
        throw httpError(403, "Entity Document types are for Legal Team Members.");
      }
      const rows = await app.db
        .select({
          id: documentTypes.id,
          displayName: documentTypes.displayName,
          systemKind: documentTypes.systemKind,
        })
        .from(documentTypes)
        .where(
          and(eq(documentTypes.module, request.query.module), isNull(documentTypes.archivedAt)),
        )
        .orderBy(asc(documentTypes.displayOrder), asc(documentTypes.createdAt));
      return { documentTypes: rows };
    },
  );
};
