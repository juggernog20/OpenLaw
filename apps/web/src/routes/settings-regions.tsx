// SPDX-License-Identifier: AGPL-3.0-only

/** SET-012 Region settings on the shared taxonomy pane, with references retained on archive. */

import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

export async function settingsRegionsLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/regions", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The Regions could not be read.");
  return { regions: data.regions };
}

const MESSAGES = defineMessages({
  pageTitle: { id: "settings.regions.pageTitle", defaultMessage: "Regions" },
  title: { id: "settings.regions.title", defaultMessage: "Regions" },
  count: {
    id: "settings.regions.count",
    defaultMessage: "{count, plural, one {# Region} other {# Regions}}",
  },
  add: { id: "settings.regions.add", defaultMessage: "Add Region" },
  addName: { id: "settings.regions.addName", defaultMessage: "New Region name" },
  renameLabel: { id: "settings.regions.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.regions.inUse",
    defaultMessage: "{count, plural, one {# reference} other {# references}}",
  },
  archive: { id: "settings.regions.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.regions.restore", defaultMessage: "Restore {name}" },
  archiveTitle: { id: "settings.regions.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.regions.archiveWarning",
    defaultMessage:
      "Archive {name}? Existing Matters and Contracts keep this Region. It leaves every picker.",
  },
  reassignLabel: {
    id: "settings.regions.reassignLabel",
    defaultMessage:
      "Reassign {count, plural, =0 {references} one {# reference} other {# references}} to",
  },
  reassignNone: { id: "settings.regions.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.regions.noCandidates",
    defaultMessage: "Regions keep existing references when archived.",
  },
  auditNote: {
    id: "settings.regions.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.regions.archiveError",
    defaultMessage: "The Region could not be archived.",
  },
  archiveSubmit: { id: "settings.regions.archiveSubmit", defaultMessage: "Archive Region" },
});

const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const result = await api
      .POST("/api/v1/regions", { body: { displayName } })
      .catch(() => undefined);
    return { data: result?.data?.region, ...(await problem(result)) };
  },
  async rename(id, displayName) {
    const result = await api
      .PATCH("/api/v1/regions/{id}", {
        params: { path: { id } },
        body: { displayName },
      })
      .catch(() => undefined);
    return { data: result?.data?.region, ...(await problem(result)) };
  },
  async archive(id, reassignToId) {
    const result = await api
      .POST("/api/v1/regions/{id}/archive", {
        params: { path: { id } },
        body: reassignToId ? { reassignToId } : {},
      })
      .catch(() => undefined);
    return { data: result?.data?.region, ...(await problem(result)) };
  },
  async restore(id) {
    const result = await api
      .POST("/api/v1/regions/{id}/restore", { params: { path: { id } } })
      .catch(() => undefined);
    return { data: result?.data?.region, ...(await problem(result)) };
  },
};

export function SettingsRegionsPage() {
  const { regions } = useLoaderData<typeof settingsRegionsLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={regions}
      tabs={null}
      archiveKeepsReferences
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
