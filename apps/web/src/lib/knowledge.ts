// SPDX-License-Identifier: AGPL-3.0-only

/** Shared vocabulary for M28's Knowledge destination and record. */
import type { paths } from "@openlaw/api-client";
import type { IntlShape } from "react-intl";

type ListAnswer =
  paths["/api/v1/knowledge"]["get"]["responses"][200]["content"]["application/json"];
type FolderAnswer =
  paths["/api/v1/knowledge/folders"]["get"]["responses"][200]["content"]["application/json"];

export type KnowledgeItem = ListAnswer["knowledgeItems"][number];
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
