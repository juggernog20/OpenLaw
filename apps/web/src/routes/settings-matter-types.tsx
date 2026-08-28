// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Matters · Types (#85), from the ST6 frame of settings.pen: the
 * MTR-001 taxonomy on the shared TaxonomyTypesPane machinery — this
 * file owns the MTR-001 vocabulary and the API adapter over the
 * matter-types routes; the behavior lives in the shared component,
 * which is the point: the Matters pane is configuration, not a copy of
 * the Contracts one. The loader is the client half of SET-002's gate;
 * the API's 403 is the real refusal.
 */

import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { requireUser } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";

/** The section URL forwards to its first pane (SET-001 deep links). */
export function settingsMattersIndexLoader() {
  return redirect("/settings/matters/types");
}

export async function settingsMatterTypesLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/matter-types", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The matter types could not be read.");
  return { matterTypes: data.matterTypes };
}

/** The MTR-001 vocabulary over the shared pane's message slots. */
const MESSAGES = defineMessages({
  pageTitle: { id: "settings.matterTypes.pageTitle", defaultMessage: "Matter types" },
  title: { id: "settings.matterTypes.title", defaultMessage: "Matter types" },
  count: {
    id: "settings.matterTypes.count",
    defaultMessage: "{count, plural, one {# type} other {# types}}",
  },
  add: { id: "settings.matterTypes.add", defaultMessage: "Add type" },
  addName: { id: "settings.matterTypes.addName", defaultMessage: "New type name" },
  help: {
    id: "settings.matterTypes.help",
    defaultMessage:
      "Drag to reorder. Archiving a type in use asks for a replacement; Other can't be archived.",
  },
  renameLabel: { id: "settings.matterTypes.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.matterTypes.inUse",
    defaultMessage: "{count, plural, one {# matter} other {# matters}}",
  },
  edit: { id: "settings.matterTypes.edit", defaultMessage: "Edit {name}" },
  locked: {
    id: "settings.matterTypes.locked",
    defaultMessage: "{name} is system-protected and can't be archived",
  },
  archive: { id: "settings.matterTypes.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.matterTypes.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.matterTypes.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.matterTypes.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.matterTypes.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.matterTypes.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {{name} is not used by any matters — it can be " +
      "archived without reassignment.} one {{name} is used by # matter. Pick a " +
      "replacement type — that matter moves to it when the type is archived.} " +
      "other {{name} is used by # matters. Pick a replacement type — those " +
      "matters move to it when the type is archived.}}",
  },
  reassignLabel: {
    id: "settings.matterTypes.reassignLabel",
    defaultMessage: "Reassign {count, plural, =0 {matters} one {# matter} other {# matters}} to",
  },
  reassignNone: { id: "settings.matterTypes.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.matterTypes.noCandidates",
    defaultMessage: "No other active type can take its matters. Add or restore another type first.",
  },
  auditNote: {
    id: "settings.matterTypes.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.matterTypes.archiveError",
    defaultMessage: "The type could not be archived.",
  },
  archiveSubmit: { id: "settings.matterTypes.archiveSubmit", defaultMessage: "Archive type" },
});

/** The shared pane's API seam over the matter-types routes. */
const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const { data, error } = await api.POST("/api/v1/matter-types", { body: { displayName } });
    return { data: data?.matterType, detail: problemDetail(error) };
  },
  async rename(id, displayName) {
    const { data, error } = await api.PATCH("/api/v1/matter-types/{id}", {
      params: { path: { id } },
      body: { displayName },
    });
    return { data: data?.matterType, detail: problemDetail(error) };
  },
  async reorder(ids) {
    const { data, error } = await api.PUT("/api/v1/matter-types/order", { body: { ids } });
    return { data: data?.matterTypes, detail: problemDetail(error) };
  },
  async archive(id, reassignToId) {
    const { data, error } = await api.POST("/api/v1/matter-types/{id}/archive", {
      params: { path: { id } },
      body: reassignToId ? { reassignToId } : {},
    });
    return { data: data?.matterType, detail: problemDetail(error) };
  },
  async restore(id) {
    const { data, error } = await api.POST("/api/v1/matter-types/{id}/restore", {
      params: { path: { id } },
    });
    return { data: data?.matterType, detail: problemDetail(error) };
  },
};

export function SettingsMatterTypesPage() {
  const { matterTypes } = useLoaderData<typeof settingsMatterTypesLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={matterTypes}
      tabs={<MattersSettingsTabs />}
      editor={{ path: (row) => `/settings/matters/types/${row.id}`, label: MESSAGES.edit }}
      protectedRow={{ slug: "other", label: MESSAGES.locked }}
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
