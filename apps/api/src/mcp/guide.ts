// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  and,
  asc,
  eq,
  isNull,
  contractTypes,
  matterTypes,
  requestTypes,
  contractStatuses,
  matterStatuses,
  contractTypeFields,
  matterTypeFields,
  departments,
  regions,
  type Db,
} from "@openlaw/db";
import { formForTouchpoint, type Form } from "@openlaw/shared";
import {
  AttachedCustomFieldSchema,
  projectCustomFields,
  selectAttachedFields,
} from "../lib/custom-fields.js";
import { readFormFields, readIntakeForm } from "../lib/intake-form.js";
import { readTypeForm } from "../lib/type-form-routes.js";
import { HttpError } from "../lib/problem.js";
import { ToolError, type ToolDefinition } from "./register.js";
import { documentationBundle } from "./documentation.js";
import {
  documentationExcerpt,
  resolveDocumentationLink,
  searchDocumentation,
} from "../../../../scripts/documentation/reader.mjs";

const guide = {
  toolset: "guide",
  kind: "read",
  legalUser: "always",
  businessUser: "always",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
} as const;
const named = z.object({ id: z.string(), slug: z.string(), displayName: z.string() });
const namedType = named.extend({ fields: z.array(AttachedCustomFieldSchema) });
const cursorSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,8})$/)
  .optional();
const pageInput = { cursor: cursorSchema, limit: z.number().int().min(1).max(100).default(100) };
const nextCursor = z.string().nullable();
// Leave space for the MCP text copy of structuredContent inside the Client's result limit.
const BYTE_BUDGET = 32_000;
function bounded<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > BYTE_BUDGET)
    throw new ToolError(
      "result_too_large",
      "This result exceeds the Tool byte budget. Narrow the selection or use a smaller page.",
    );
  return value;
}
function page<T>(items: T[], cursor: string | undefined, limit: number) {
  const offset = Number(cursor ?? 0);
  const result: T[] = [];
  for (const item of items.slice(offset, offset + limit)) {
    if (Buffer.byteLength(JSON.stringify([...result, item])) > BYTE_BUDGET - 2000) {
      if (!result.length) bounded(item);
      break;
    }
    result.push(item);
  }
  if (!result.length && offset < items.length)
    throw new ToolError("result_too_large", "One entry exceeds the Tool byte budget.");
  return {
    items: result,
    nextCursor: offset + result.length < items.length ? String(offset + result.length) : null,
  };
}
const vocabularyInput = z.object(pageInput).strict();
export const VocabularyOutput = z.object({
  contractTypes: z.array(namedType.extend({ isDefault: z.boolean() })),
  matterTypes: z.array(namedType.extend({ isDefault: z.boolean() })),
  requestTypes: z.array(
    namedType.extend({ targetModule: z.string(), targetTypeId: z.string().nullable() }),
  ),
  contractStatuses: z.array(named.extend({ stage: z.string() })),
  matterStatuses: z.array(named.extend({ category: z.string() })),
  departments: z.array(named),
  regions: z.array(named),
  nextCursor,
});
const formInput = z
  .object({ kind: z.enum(["request", "contract", "matter"]), typeId: z.string().min(1).max(128) })
  .strict();
const scalar = z.union([z.string(), z.number(), z.boolean()]);
const row = z.object({
  kind: z.literal("row"),
  id: z.string(),
  parentBranchId: z.string().nullable(),
  rowRef: z.string(),
  fieldType: z.string(),
  onIntakeForm: z.boolean().optional(),
  isRequired: z.boolean(),
  visibleOnPortal: z.boolean(),
});
const branch = z.object({
  kind: z.literal("branch"),
  id: z.string(),
  parentBranchId: z.string().nullable(),
  match: z.enum(["all", "any"]),
  conditions: z.array(
    z.object({
      rowRef: z.string(),
      operator: z.string(),
      value: z.union([scalar, z.array(scalar), z.null()]),
    }),
  ),
});
export const FormOutput = z.object({
  kind: z.string(),
  typeId: z.string(),
  module: z.string(),
  destinationTypeId: z.string(),
  nodes: z.array(z.union([row, branch])),
  fields: z.array(AttachedCustomFieldSchema),
  basics: z.array(z.string()),
  departments: z.array(named),
  regions: z.array(named),
});
// Preorder and parent ids retain arbitrary Branch depth without recursive JSON Schema references.
function flatten(
  form: Form,
  parentBranchId: string | null = null,
): z.infer<typeof FormOutput>["nodes"] {
  return form.flatMap((node): z.infer<typeof FormOutput>["nodes"] => {
    if (node.kind === "row") return [{ ...node, parentBranchId }];
    const { children, ...definition } = node;
    return [
      {
        ...definition,
        conditions: definition.conditions.map((c) => ({
          ...c,
          value: Array.isArray(c.value)
            ? [...c.value]
            : (c.value as string | number | boolean | null),
        })),
        parentBranchId,
      },
      ...flatten(children, node.id),
    ];
  });
}
async function options(db: Db) {
  const [departmentRows, regionRows] = await Promise.all([
    db
      .select()
      .from(departments)
      .where(isNull(departments.archivedAt))
      .orderBy(asc(departments.displayOrder), asc(departments.id)),
    db
      .select()
      .from(regions)
      .where(isNull(regions.archivedAt))
      .orderBy(asc(regions.displayOrder), asc(regions.id)),
  ]);
  return {
    departments: departmentRows.map((r) => named.parse(r)),
    regions: regionRows.map((r) => named.parse(r)),
  };
}
async function liveType(db: Db, kind: "request" | "contract" | "matter", id: string) {
  const table =
    kind === "request" ? requestTypes : kind === "contract" ? contractTypes : matterTypes;
  const [type] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), isNull(table.archivedAt)));
  if (!type) throw new ToolError("type_not_found", `That ${kind} type is not available.`);
}
const searchInput = z
  .object({
    query: z.string().max(1000).default(""),
    section: z.string().max(128).optional(),
    ...pageInput,
  })
  .strict();
const articleSummary = z.object({
  id: z.string(),
  title: z.string(),
  section: z.string(),
  unverified: z.boolean(),
});
export const DocsSearchOutput = z.object({
  articles: z.array(articleSummary.extend({ excerpt: z.string() })),
  nextCursor,
});
const readInput = z.object({ id: z.string().min(1).max(256), cursor: cursorSchema }).strict();
export const DocsReadOutput = articleSummary.extend({
  text: z.string(),
  nextCursor,
  editionId: z.string(),
  outline: z.array(z.object({ id: z.string(), text: z.string(), depth: z.number() })),
});

export const guideTools: readonly ToolDefinition[] = [
  {
    ...guide,
    name: "openlaw_vocabulary",
    title: "Read OpenLaw vocabulary",
    description:
      "Read live configured Contract types, Matter types, Request types, their Fields, statuses, Departments and Regions. Business Users see only Portal-visible Fields. Results page across the named collections in their listed order; continue with nextCursor until null.",
    inputSchema: vocabularyInput,
    outputSchema: VocabularyOutput,
    run: async (input, { db, user }) => {
      const { cursor, limit } = vocabularyInput.parse(input);
      const [contracts, matters, requests, contractStates, matterStates, choices] =
        await Promise.all([
          db
            .select()
            .from(contractTypes)
            .where(isNull(contractTypes.archivedAt))
            .orderBy(asc(contractTypes.displayOrder), asc(contractTypes.id)),
          db
            .select()
            .from(matterTypes)
            .where(isNull(matterTypes.archivedAt))
            .orderBy(asc(matterTypes.displayOrder), asc(matterTypes.id)),
          db
            .select()
            .from(requestTypes)
            .where(isNull(requestTypes.archivedAt))
            .orderBy(asc(requestTypes.displayOrder), asc(requestTypes.id)),
          db
            .select()
            .from(contractStatuses)
            .where(isNull(contractStatuses.archivedAt))
            .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.id)),
          db
            .select()
            .from(matterStatuses)
            .where(isNull(matterStatuses.archivedAt))
            .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.id)),
          options(db),
        ]);
      const [contractRows, matterRows, requestRows] = await Promise.all([
        Promise.all(
          contracts.map(async (t) => ({
            ...named.parse(t),
            isDefault: t.isDefault,
            fields: projectCustomFields(
              user.role,
              await selectAttachedFields(db, contractTypeFields, t.id),
              {},
            ).fields,
          })),
        ),
        Promise.all(
          matters.map(async (t) => ({
            ...named.parse(t),
            isDefault: t.isDefault,
            fields: projectCustomFields(
              user.role,
              await selectAttachedFields(db, matterTypeFields, t.id),
              {},
            ).fields,
          })),
        ),
        Promise.all(
          requests.map(async (t) => {
            const intake = await readIntakeForm(db, t.id);
            return {
              ...named.parse(t),
              targetModule: intake.module,
              targetTypeId: intake.typeId,
              fields: intake.fields,
            };
          }),
        ),
      ]);
      const collections = {
        contractTypes: contractRows,
        matterTypes: matterRows,
        requestTypes: requestRows,
        contractStatuses: contractStates.map((t) => ({ ...named.parse(t), stage: t.stage })),
        matterStatuses: matterStates.map((t) => ({ ...named.parse(t), category: t.category })),
        ...choices,
      };
      const entries = Object.entries(collections).flatMap(([collection, values]) =>
        values.map((value) => ({ collection, value })),
      );
      const selected = page(entries, cursor, limit);
      const result: Record<string, unknown> = Object.fromEntries(
        Object.keys(collections).map((key) => [
          key,
          selected.items.filter((i) => i.collection === key).map((i) => i.value),
        ]),
      );
      return bounded({ ...result, nextCursor: selected.nextCursor });
    },
  },
  {
    ...guide,
    name: "openlaw_docs_search",
    title: "Search product documentation",
    description:
      "Search the bundled product documentation using the web app's ranking and excerpts. Empty query browses articles. Continue with nextCursor and the same query and section. unverified marks an article whose validation is pending.",
    inputSchema: searchInput,
    outputSchema: DocsSearchOutput,
    run: async (input) => {
      const { query, section, cursor, limit } = searchInput.parse(input);
      const hits = searchDocumentation(documentationBundle(), { query, section });
      const selected = page(
        hits.map((a) => ({ ...articleSummary.parse(a), excerpt: documentationExcerpt(a, query) })),
        cursor,
        limit,
      );
      return bounded({ articles: selected.items, nextCursor: selected.nextCursor });
    },
  },
  {
    ...guide,
    name: "openlaw_docs_read",
    title: "Read a documentation article",
    description:
      "Read one bundled product documentation article by its id from openlaw_docs_search. Stable article aliases resolve to the current id. Continue with nextCursor and the same id for long articles. unverified marks validation pending.",
    inputSchema: readInput,
    outputSchema: DocsReadOutput,
    run: async (input) => {
      const { id, cursor } = readInput.parse(input);
      const bundle = documentationBundle();
      const resolved = resolveDocumentationLink(bundle, id)?.split("#")[0];
      const article = searchDocumentation(bundle).find((a) => a.id === resolved);
      if (!article)
        throw new ToolError(
          "article_not_found",
          "That documentation article is not available in this edition.",
        );
      const offset = Number(cursor ?? 0);
      let end = Math.min(article.text.length, offset + 12_000);
      const result = () => ({
        ...articleSummary.parse(article),
        editionId: bundle.edition.id,
        outline: article.outline,
        text: article.text.slice(offset, end),
        nextCursor: end < article.text.length ? String(end) : null,
      });
      while (Buffer.byteLength(JSON.stringify(result())) > BYTE_BUDGET && end > offset)
        end = offset + Math.floor((end - offset) / 2);
      if (end === offset && offset < article.text.length)
        throw new ToolError(
          "result_too_large",
          "This article's metadata exceeds the Tool byte budget.",
        );
      return bounded(result());
    },
  },
  {
    ...guide,
    name: "openlaw_form_get",
    title: "Read a type Form",
    description:
      "Read the Intake Form for kind request, or the creation Form for kind contract or matter, by typeId from openlaw_vocabulary. Business Users may read request Forms. nodes are in document order; parentBranchId preserves Branch nesting. Conditions govern visibility and Required. Ask the person for missing answers before creating or submitting. Auto-Doc Forms are not supported yet.",
    inputSchema: formInput,
    outputSchema: FormOutput,
    run: async (input, { db, user }) => {
      const { kind, typeId } = formInput.parse(input);
      if (user.role === "business_user" && kind !== "request")
        throw new ToolError(
          "forbidden",
          "Contract and Matter creation Forms require a Legal User. Use a Request Form.",
        );
      await liveType(db, kind, typeId);
      const choices = await options(db);
      if (kind === "request") {
        try {
          const intake = await readIntakeForm(db, typeId);
          return bounded({
            kind,
            typeId,
            module: intake.module,
            destinationTypeId: intake.typeId,
            nodes: flatten(intake.form),
            fields: intake.fields,
            basics: ["title", "department", "urgency", "attachments"],
            ...choices,
          });
        } catch (error) {
          if (error instanceof HttpError) throw new ToolError("form_unavailable", error.message);
          throw error;
        }
      }
      const form = formForTouchpoint(await readTypeForm(db, kind, typeId), "creation");
      const { fields } = await readFormFields(db, form, kind, typeId, "creation");
      return bounded({
        kind,
        typeId,
        module: kind,
        destinationTypeId: typeId,
        nodes: flatten(form),
        fields,
        basics: [],
        ...choices,
      });
    },
  },
];
