// SPDX-License-Identifier: AGPL-3.0-only
/** CTR-016: shared Type attachment tables used by Field validation. */
import type {
  contractTypeFields,
  entityTypeFields,
  matterTypeFields,
  requestTypeFields,
} from "@openlaw/db";

/** Shared by HTTP Field attachment routes and background extraction. */
export type TypeFieldsTable =
  | typeof contractTypeFields
  | typeof entityTypeFields
  | typeof matterTypeFields
  | typeof requestTypeFields;
