// SPDX-License-Identifier: AGPL-3.0-only

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
