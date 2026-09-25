// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Condition choices for the kinds other than Contract and Matter
 * (DOC-009). Document, Entity, Request and Knowledge Item properties
 * read their options from each module's own filter endpoints, so a
 * search condition offers the same choices as that module's list
 * filter.
 */

import { useEffect, useState } from "react";
import { defineMessages, useIntl } from "react-intl";
import type { SearchQuestion } from "@openlaw/shared";
import { api } from "../../lib/api";
import { DOCUMENT_REPOSITORY_FORMATS } from "../../lib/documents";
import { knowledgeStateLabel, folderLabel } from "../../lib/knowledge";
import { FORMAT_MESSAGES } from "../documents/document-filter-bar";
import { useEntityFilterDefinitions } from "../entities/entity-filter-definitions";
import { useInboxFilterDefinitions } from "../inbox/inbox-filter-definitions";
import { searchKindLabel } from "./search-result-row";
import type { Condition } from "./condition-definitions";

type Choice = { id: string; displayName: string };
type Choices = Record<string, Choice[]>;
const TEXT_STATES = defineMessages({
  ready: { id: "search.textState.ready", defaultMessage: "Ready" },
  pending: { id: "search.textState.pending", defaultMessage: "Pending" },
  failed: { id: "search.textState.failed", defaultMessage: "Failed" },
  unsupported: { id: "search.textState.unsupported", defaultMessage: "Unsupported" },
});

export function useOtherConditionDefinitions(kinds: SearchQuestion["kinds"]) {
  const intl = useIntl();
  const document = kinds.includes("document");
  const entity = kinds.includes("entity");
  const request = kinds.includes("request");
  const knowledge = kinds.includes("knowledge_item");
  const [loaded, setLoaded] = useState<{ choices: Choices; error: string | null }>({
    choices: {},
    error: null,
  });
  useEffect(() => {
    let live = true;
    async function read() {
      const choices: Choices = {};
      const error = intl.formatMessage({
        id: "search.choices.error",
        defaultMessage: "Condition choices could not load.",
      });
      try {
        const [docs, docTypes, entityOptions, entityTypes, requests, knowledgeTypes, folders] =
          await Promise.all([
            document ? api.GET("/api/v1/documents/options") : undefined,
            document
              ? Promise.all(
                  (["contract", "matter", "entity"] as const).map((module) =>
                    api.GET("/api/v1/documents/type-options", { params: { query: { module } } }),
                  ),
                )
              : [],
            entity ? api.GET("/api/v1/entities/list-options") : undefined,
            entity ? api.GET("/api/v1/entities/types") : undefined,
            request ? api.GET("/api/v1/requests/filter-options") : undefined,
            knowledge || document ? api.GET("/api/v1/knowledge/type-options") : undefined,
            knowledge ? api.GET("/api/v1/knowledge/folders") : undefined,
          ]);
        choices["document.counterparty"] =
          docs?.data?.counterparties.map((row) => ({ id: row.id, displayName: row.name })) ?? [];
        choices["document.uploader"] =
          docs?.data?.uploaders.map((row) => ({
            id: row.id,
            displayName: row.archived
              ? intl.formatMessage(
                  { id: "documents.filter.uploader.archived", defaultMessage: "{name} (archived)" },
                  { name: row.displayName },
                )
              : row.displayName,
          })) ?? [];
        choices["document.type"] = [
          ...docTypes.flatMap((result) => result.data?.documentTypes ?? []),
          ...(knowledgeTypes?.data?.knowledgeTypes ?? []),
        ];
        choices["entity.type"] = entityTypes?.data?.entityTypes ?? [];
        choices["entity.jurisdiction"] =
          entityOptions?.data?.jurisdictions.map((id) => ({ id, displayName: id })) ?? [];
        choices["entity.majorityOwner"] =
          entityOptions?.data?.majorityOwners.map((row) => ({
            id: row.id,
            displayName: row.legalName,
          })) ?? [];
        choices["request.type"] = requests?.data?.types ?? [];
        choices["request.requester"] = requests?.data?.people ?? [];
        choices["knowledge_item.type"] = knowledgeTypes?.data?.knowledgeTypes ?? [];
        choices["knowledge_item.folder"] =
          folders?.data?.folders.map((row) => ({
            id: row.id,
            displayName: folderLabel(folders.data.folders, row.id),
          })) ?? [];
        const failed = [
          docs,
          ...docTypes,
          entityOptions,
          entityTypes,
          requests,
          knowledgeTypes,
          folders,
        ].some((result) => result && !result.data);
        if (live) setLoaded({ choices, error: failed ? error : null });
      } catch {
        if (live) setLoaded({ choices: {}, error });
      }
    }
    void read();
    return () => {
      live = false;
    };
  }, [document, entity, request, knowledge, intl]);
  const entityFilters = useEntityFilterDefinitions({
    types: [],
    jurisdictions: [],
    majorityOwners: [],
  });
  const requestFilters = useInboxFilterDefinitions({
    types: loaded.choices["request.type"] ?? [],
    people: loaded.choices["request.requester"] ?? [],
  });
  const choices = ({ kind, property }: Pick<Condition, "kind" | "property">): Choice[] => {
    if (kind === "request") {
      const filter = requestFilters.find((filter) => filter.key === property);
      return filter?.kind === "choices" ? filter.choices : [];
    }
    if (kind === "entity" && property === "status") {
      const filter = entityFilters.find((filter) => filter.key === property);
      return filter?.kind === "choices" ? filter.choices : [];
    }
    if (kind === "document" && property === "owner")
      return [
        ...(["contract", "matter", "entity", "knowledge_item"] as const).map((id) => ({
          id,
          displayName: searchKindLabel(intl, id),
        })),
        {
          id: "auto_doc",
          displayName: intl.formatMessage({ id: "nav.autoDocs", defaultMessage: "Auto-Docs" }),
        },
      ];
    if (kind === "document" && property === "format")
      return DOCUMENT_REPOSITORY_FORMATS.map((id) => ({
        id,
        displayName: intl.formatMessage(FORMAT_MESSAGES[id]),
      }));
    if (kind === "document" && property === "textState")
      return (Object.keys(TEXT_STATES) as (keyof typeof TEXT_STATES)[]).map((id) => ({
        id,
        displayName: intl.formatMessage(TEXT_STATES[id]),
      }));
    if (kind === "knowledge_item" && property === "state")
      return (["draft", "published"] as const).map((id) => ({
        id,
        displayName: knowledgeStateLabel(intl, id),
      }));
    return loaded.choices[`${kind}.${property}`] ?? [];
  };
  return { choices, error: loaded.error };
}
