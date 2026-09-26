// SPDX-License-Identifier: AGPL-3.0-only

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
