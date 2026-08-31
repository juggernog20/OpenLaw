// SPDX-License-Identifier: AGPL-3.0-only

/** Knowledge · Types: KNW-001 on the shared TECH-023 taxonomy editor. */
import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { KnowledgeSettingsTabs } from "../components/knowledge-settings-tabs";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

export function settingsKnowledgeIndexLoader() {
  return redirect("/settings/knowledge/types");
}

export async function settingsKnowledgeTypesLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/knowledge/types", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The Knowledge types could not be read.");
  return { knowledgeTypes: data.knowledgeTypes };
}

const MESSAGES = defineMessages({
  pageTitle: { id: "settings.knowledgeTypes.pageTitle", defaultMessage: "Knowledge types" },
  title: { id: "settings.knowledgeTypes.title", defaultMessage: "Knowledge types" },
  count: {
    id: "settings.knowledgeTypes.count",
    defaultMessage: "{count, plural, one {# type} other {# types}}",
  },
  add: { id: "settings.knowledgeTypes.add", defaultMessage: "Add type" },
  addName: { id: "settings.knowledgeTypes.addName", defaultMessage: "New type name" },
  help: {
    id: "settings.knowledgeTypes.help",
    defaultMessage: "Drag to reorder. Archiving a type in use asks for a replacement.",
  },
  renameLabel: { id: "settings.knowledgeTypes.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.knowledgeTypes.inUse",
    defaultMessage: "{count, plural, one {# knowledge item} other {# knowledge items}}",
  },
  archive: { id: "settings.knowledgeTypes.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.knowledgeTypes.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.knowledgeTypes.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.knowledgeTypes.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.knowledgeTypes.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.knowledgeTypes.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {{name} is not used by any knowledge items — it can be " +
      "archived without reassignment.} one {{name} is used by # knowledge item. Pick a " +
      "replacement type — that item moves to it when the type is archived.} " +
      "other {{name} is used by # knowledge items. Pick a replacement type — those " +
      "items move to it when the type is archived.}}",
  },
  reassignLabel: {
    id: "settings.knowledgeTypes.reassignLabel",
    defaultMessage:
      "Reassign {count, plural, =0 {knowledge items} one {# knowledge item} other {# knowledge items}} to",
  },
  reassignNone: { id: "settings.knowledgeTypes.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.knowledgeTypes.noCandidates",
    defaultMessage:
      "No other active type can take its knowledge items. Add or restore another type first.",
  },
  auditNote: {
    id: "settings.knowledgeTypes.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.knowledgeTypes.archiveError",
    defaultMessage: "The type could not be archived.",
  },
  archiveSubmit: { id: "settings.knowledgeTypes.archiveSubmit", defaultMessage: "Archive type" },
});

const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const result = await api
      .POST("/api/v1/knowledge/types", { body: { displayName } })
      .catch(() => undefined);
    return { data: result?.data?.knowledgeType, ...(await problem(result)) };
  },
  async rename(id, displayName) {
    const result = await api
      .PATCH("/api/v1/knowledge/types/{id}", {
        params: { path: { id } },
        body: { displayName },
      })
      .catch(() => undefined);
    return { data: result?.data?.knowledgeType, ...(await problem(result)) };
  },
  async reorder(ids) {
    const result = await api
      .PUT("/api/v1/knowledge/types/order", { body: { ids } })
      .catch(() => undefined);
    return { data: result?.data?.knowledgeTypes, ...(await problem(result)) };
  },
  async archive(id, reassignToId) {
    const result = await api
      .POST("/api/v1/knowledge/types/{id}/archive", {
        params: { path: { id } },
        body: reassignToId ? { reassignToId } : {},
      })
      .catch(() => undefined);
    return { data: result?.data?.knowledgeType, ...(await problem(result)) };
  },
  async restore(id) {
    const result = await api
      .POST("/api/v1/knowledge/types/{id}/restore", { params: { path: { id } } })
      .catch(() => undefined);
    return { data: result?.data?.knowledgeType, ...(await problem(result)) };
  },
};

export function SettingsKnowledgeTypesPage() {
  const { knowledgeTypes } = useLoaderData<typeof settingsKnowledgeTypesLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={knowledgeTypes}
      tabs={<KnowledgeSettingsTabs />}
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
