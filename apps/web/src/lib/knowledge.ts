// SPDX-License-Identifier: AGPL-3.0-only

/** Shared vocabulary for M28's Knowledge destination and record. */
import type { paths } from "@openlaw/api-client";
import type { IntlShape } from "react-intl";

type ListAnswer =
  paths["/api/v1/knowledge"]["get"]["responses"][200]["content"]["application/json"];
type RecordAnswer =
  paths["/api/v1/knowledge/{id}"]["get"]["responses"][200]["content"]["application/json"];
type FolderAnswer =
  paths["/api/v1/knowledge/folders"]["get"]["responses"][200]["content"]["application/json"];

/** One managed-list row. The list leaves the guidance body out. */
export type KnowledgeItem = ListAnswer["knowledgeItems"][number];
/** The record page's item, body included. */
export type KnowledgeRecord = RecordAnswer["knowledgeItem"];
export type KnowledgeFolder = FolderAnswer["folders"][number];
export type KnowledgeState = KnowledgeItem["state"];
export type KnowledgeAudience = KnowledgeItem["audience"];

export function knowledgeStateLabel(intl: IntlShape, value: KnowledgeState): string {
  return value === "draft"
    ? intl.formatMessage({ id: "knowledge.state.draft", defaultMessage: "Draft" })
    : intl.formatMessage({ id: "knowledge.state.published", defaultMessage: "Published" });
}

export function knowledgeAudienceLabel(intl: IntlShape, value: KnowledgeAudience): string {
  return value === "legal_only"
    ? intl.formatMessage({ id: "knowledge.audience.legalOnly", defaultMessage: "Legal Only" })
    : intl.formatMessage({ id: "knowledge.audience.everyone", defaultMessage: "Everyone" });
}

/** The list's format filter values, in the order the filter offers them. */
export const KNOWLEDGE_FORMATS = ["pdf", "word", "powerpoint", "image", "email", "other"] as const;

/**
 * One label set for a primary Document's render family, shared by the
 * Format column and the Format filter so the two cannot drift. The
 * column speaks renderFamily (`presentation`), the filter speaks the
 * API's format key (`powerpoint`); both arms answer the same word.
 */
export function knowledgeFormatLabel(intl: IntlShape, family: string): string {
  return intl.formatMessage(
    {
      id: "knowledge.format.label",
      defaultMessage:
        "{family, select, pdf {PDF} word {Word} presentation {PowerPoint} powerpoint {PowerPoint} image {Image} email {Email} other {Other}}",
    },
    { family },
  );
}

/** Depth in the API's parent-before-child tree, for visual indentation. */
export function folderDepth(folders: readonly KnowledgeFolder[], folder: KnowledgeFolder): number {
  const byId = new Map(folders.map((row) => [row.id, row]));
  let depth = 0;
  let parentId = folder.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return depth;
}

export function folderLabel(folders: readonly KnowledgeFolder[], id: string | null): string {
  if (!id) return "";
  const byId = new Map(folders.map((row) => [row.id, row]));
  const names: string[] = [];
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(" / ");
}
