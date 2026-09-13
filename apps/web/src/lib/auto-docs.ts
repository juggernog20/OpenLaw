// SPDX-License-Identifier: AGPL-3.0-only

/** Validate multipart upload replies before replacing the editor's saved record. */
import { z } from "zod";
import type { paths } from "@openlaw/api-client";

type UploadAnswer =
  paths["/api/v1/auto-docs/{id}/template"]["post"]["responses"][201]["content"]["application/json"];
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
const Field = z.object({
  slug: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  fieldType: autoDocFieldTypes,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  placeholder: z.boolean(),
});
const FormVersion = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  definition: z.object({ fields: z.array(Field) }),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const autoDocUploadAnswer = z.object({
  autoDoc: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    state: z.enum(["draft", "published", "archived"]),
    templateDocumentId: z.string().nullable(),
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
