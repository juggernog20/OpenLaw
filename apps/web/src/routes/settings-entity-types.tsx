// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entities · Types (#97): the ENT-001 taxonomy on the shared
 * TaxonomyTypesPane machinery — this file owns the ENT-001 vocabulary
 * and the API adapter over the entity-types routes; the behavior lives
 * in the shared component, which is the point: the Entities pane is
 * configuration, not a copy of the Matters one. There is no per-row
 * editor screen — entity-scoped fields render on every entity (ENT-001),
 * so nothing attaches per type. The loader is the client half of
 * SET-002's gate; the API's 403 is the real refusal.
 */

import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { EntitiesSettingsTabs } from "../components/entities-settings-tabs";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";

/** The section URL forwards to its first pane (SET-001 deep links). */
export function settingsEntitiesIndexLoader() {
  return redirect("/settings/entities/types");
}

export async function settingsEntityTypesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/entity-types", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The entity types could not be read.");
  return { entityTypes: data.entityTypes };
}

/** The ENT-001 vocabulary over the shared pane's message slots. */
const MESSAGES = defineMessages({
  pageTitle: { id: "settings.entityTypes.pageTitle", defaultMessage: "Entity types" },
  title: { id: "settings.entityTypes.title", defaultMessage: "Entity types" },
  count: {
    id: "settings.entityTypes.count",
    defaultMessage: "{count, plural, one {# type} other {# types}}",
  },
  add: { id: "settings.entityTypes.add", defaultMessage: "Add type" },
  addName: { id: "settings.entityTypes.addName", defaultMessage: "New type name" },
  help: {
    id: "settings.entityTypes.help",
    defaultMessage:
      "Drag to reorder. Archiving a type in use asks for a replacement; Other can't be archived.",
  },
  renameLabel: { id: "settings.entityTypes.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.entityTypes.inUse",
    defaultMessage: "{count, plural, one {# entity} other {# entities}}",
  },
  locked: {
    id: "settings.entityTypes.locked",
    defaultMessage: "{name} is system-protected and can't be archived",
  },
  archive: { id: "settings.entityTypes.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.entityTypes.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.entityTypes.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.entityTypes.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.entityTypes.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.entityTypes.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {{name} is not used by any entities — it can be " +
      "archived without reassignment.} one {{name} is used by # entity. Pick a " +
      "replacement type — that entity moves to it when the type is archived.} " +
      "other {{name} is used by # entities. Pick a replacement type — those " +
      "entities move to it when the type is archived.}}",
  },
  reassignLabel: {
    id: "settings.entityTypes.reassignLabel",
    defaultMessage: "Reassign {count, plural, =0 {entities} one {# entity} other {# entities}} to",
  },
  reassignNone: { id: "settings.entityTypes.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.entityTypes.noCandidates",
    defaultMessage:
      "No other active type can take its entities. Add or restore another type first.",
  },
  auditNote: {
    id: "settings.entityTypes.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.entityTypes.archiveError",
    defaultMessage: "The type could not be archived.",
  },
  archiveSubmit: { id: "settings.entityTypes.archiveSubmit", defaultMessage: "Archive type" },
});

/** The shared pane's API seam over the entity-types routes. */
const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const { data, error } = await api.POST("/api/v1/entity-types", { body: { displayName } });
    return { data: data?.entityType, detail: problemDetail(error) };
  },
  async rename(id, displayName) {
    const { data, error } = await api.PATCH("/api/v1/entity-types/{id}", {
      params: { path: { id } },
      body: { displayName },
    });
    return { data: data?.entityType, detail: problemDetail(error) };
  },
  async reorder(ids) {
    const { data, error } = await api.PUT("/api/v1/entity-types/order", { body: { ids } });
    return { data: data?.entityTypes, detail: problemDetail(error) };
  },
  async archive(id, reassignToId) {
    const { data, error } = await api.POST("/api/v1/entity-types/{id}/archive", {
      params: { path: { id } },
      body: reassignToId ? { reassignToId } : {},
    });
    return { data: data?.entityType, detail: problemDetail(error) };
  },
  async restore(id) {
    const { data, error } = await api.POST("/api/v1/entity-types/{id}/restore", {
      params: { path: { id } },
    });
    return { data: data?.entityType, detail: problemDetail(error) };
  },
};

export function SettingsEntityTypesPage() {
  const { entityTypes } = useLoaderData<typeof settingsEntityTypesLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={entityTypes}
      tabs={<EntitiesSettingsTabs />}
      protectedRow={{ slug: "other", label: MESSAGES.locked }}
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
