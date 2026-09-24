// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

/** One live catalog Field as the search surfaces read it: the slug that
 * keys the record's stored custom Fields, the display name the picker and
 * the chip show, and the type that picks the operator set. */
export const SearchFieldSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  moduleScope: z.enum(["contract", "matter", "entity"]),
  fieldType: z.enum([
    "text",
    "long_text",
    "number",
    "currency",
    "date",
    "boolean",
    "single_select",
    "multi_select",
    "user",
    "entity",
  ]),
  options: z.array(z.string()).nullable(),
});
export type SearchField = z.infer<typeof SearchFieldSchema>;
/** The search kinds that carry catalog Fields. */
export const SEARCH_FIELD_KINDS = SearchFieldSchema.shape.moduleScope.options;
export const SEARCH_FIELD_TYPES = SearchFieldSchema.shape.fieldType.options;
/** Operators that read presence or a fixed answer, so the condition carries no value. */
export function isValuelessOperator(operator: string): boolean {
  return ["is_empty", "is_not_empty", "is_yes", "is_no"].includes(operator);
}
