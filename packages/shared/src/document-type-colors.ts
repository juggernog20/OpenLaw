// SPDX-License-Identifier: AGPL-3.0-only

/** The colours an Administrator can give a Document type. The database
 * check on `document_types.color` lists the same values. */
export const DOCUMENT_TYPE_COLORS = [
  "grey",
  "blue",
  "amber",
  "green",
  "red",
  "orange",
  "purple",
] as const;
export type DocumentTypeColor = (typeof DOCUMENT_TYPE_COLORS)[number];
