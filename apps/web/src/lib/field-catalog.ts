// SPDX-License-Identifier: AGPL-3.0-only

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { CONTRACT_OVERVIEW_FIELD_SLUGS } from "@openlaw/shared";

export type ModuleScope = "contract" | "matter" | "entity";
export type Scope = ModuleScope | "global";
export type ApiField =
  paths["/api/v1/fields"]["get"]["responses"]["200"]["content"]["application/json"]["fields"][number];
export type FieldRow = ApiField & { moduleScope: Scope };

/** The custom fields shown in each module's Settings catalog. */
export function isFieldRow(field: ApiField, module: ModuleScope): field is FieldRow {
  return (
    (module !== "contract" || !CONTRACT_OVERVIEW_FIELD_SLUGS.includes(field.slug)) &&
    (field.moduleScope === module || field.moduleScope === "global")
  );
}

/** The nine CTR-016 field types, immutable after creation. */
export const FIELD_TYPES = [
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
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The select types — the only ones that carry an options list. */
export const SELECT_TYPES = new Set<FieldType>(["single_select", "multi_select"]);

export const TAGS = ["business", "legal"] as const;
export type Tag = (typeof TAGS)[number];

export function fieldRow(field: ApiField, module: ModuleScope): FieldRow {
  if (!isFieldRow(field, module)) {
    throw new Error(`A ${module} field operation returned a field outside this catalog.`);
  }
  return field;
}

export function typeLabel(intl: IntlShape, fieldType: FieldType): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.typeLabel",
      defaultMessage:
        "{type, select, text {Text} long_text {Long text} number {Number} " +
        "date {Date} currency {Currency} boolean {Boolean} single_select {Single select} " +
        "multi_select {Multi select} user {User} entity {Entity} other {Unknown}}",
    },
    { type: fieldType },
  );
}

export function scopeLabel(intl: IntlShape, scope: Scope): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.scopeLabel",
      defaultMessage:
        "{scope, select, contract {Contract} matter {Matter} entity {Entity} global {Global} other {Unknown}}",
    },
    { scope },
  );
}

export function tagLabel(intl: IntlShape, tag: Tag): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.tagLabel",
      defaultMessage: "{tag, select, business {Business} legal {Legal} other {Unknown}}",
    },
    { tag },
  );
}

