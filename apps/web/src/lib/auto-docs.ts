// SPDX-License-Identifier: AGPL-3.0-only

/** Validate multipart upload replies before replacing the editor's saved record. */
import { z } from "zod";
import type { paths } from "@openlaw/api-client";

export type AutoDocAnswer =
  paths["/api/v1/auto-docs/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type AutoDocOptions =
  paths["/api/v1/auto-docs/options"]["get"]["responses"][200]["content"]["application/json"];
export type AutoDocField = NonNullable<
  AutoDocAnswer["formVersion"]
>["definition"]["fields"][number];
export type AutoDocClauseRule = NonNullable<
  AutoDocAnswer["formVersion"]
>["definition"]["clauseRules"][number];

type UploadAnswer =
  paths["/api/v1/auto-docs/{id}/template"]["post"]["responses"][201]["content"]["application/json"];
export const autoDocStates = z.enum(["draft", "published", "archived"]);
export const autoDocListStates = z.enum([...autoDocStates.options, "all"]);
export const autoDocAudiences = z.enum(["legal_only", "selected", "everyone"]);
export const autoDocFieldTypes = z.enum([
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "boolean",
  "single_select",
  "multi_select",
  "entity",
]);
export const autoDocContractAttributes = z.enum([
  "title",
  "primary_counterparty_name",
  "entity_id",
  "owning_department_id",
  "region",
  "value",
  "effective_date",
  "expiry_date",
  "term_type",
]);
export const autoDocClauseRule = z.object({
  blockName: z.string(),
  fieldSlug: z.string(),
  operator: z.enum(["equals", "is_one_of", "is_set", "is_not"]),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
    z.null(),
  ]),
});
const Field = z.object({
  slug: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  fieldType: autoDocFieldTypes,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  placeholder: z.boolean(),
  catalogFieldId: z.string().nullable(),
  contractAttribute: autoDocContractAttributes.nullable(),
});
const FormVersion = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  definition: z.object({ fields: z.array(Field), clauseRules: z.array(autoDocClauseRule) }),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const autoDocUploadAnswer = z.object({
  autoDoc: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    state: autoDocStates,
    templateDocumentId: z.string().nullable(),
    audience: autoDocAudiences,
    targetContractTypeId: z.string().nullable(),
    publishedDocumentVersionId: z.string().nullable(),
    publishedFormVersionId: z.string().nullable(),
    publishedAt: z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  template: z
    .object({
      id: z.string(),
      title: z.string(),
      versions: z.array(
        z.object({
          id: z.string(),
          versionNumber: z.number().int().positive(),
          originalFilename: z.string(),
          byteSize: z.number().nonnegative(),
          createdAt: z.string(),
        }),
      ),
    })
    .nullable(),
  detection: z.object({ placeholders: z.array(z.string()), blocks: z.array(z.string()) }),
  formVersion: FormVersion.nullable(),
  formVersions: z.array(FormVersion),
  orphanedFields: z.array(z.string()),
}) satisfies z.ZodType<UploadAnswer>;
