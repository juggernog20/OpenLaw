// SPDX-License-Identifier: AGPL-3.0-only

/** SET-010 Department settings on the shared taxonomy pane, with references retained on archive. */

import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

export async function settingsDepartmentsLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/departments", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The Departments could not be read.");
  return { departments: data.departments };
}

const MESSAGES = defineMessages({
  pageTitle: { id: "settings.departments.pageTitle", defaultMessage: "Departments" },
  title: { id: "settings.departments.title", defaultMessage: "Departments" },
  count: {
    id: "settings.departments.count",
    defaultMessage: "{count, plural, one {# Department} other {# Departments}}",
  },
  add: { id: "settings.departments.add", defaultMessage: "Add Department" },
  addName: { id: "settings.departments.addName", defaultMessage: "New Department name" },
  help: {
    id: "settings.departments.help",
    defaultMessage:
      "Drag to reorder. Archiving a Department removes it from pickers and keeps existing references.",
  },
  renameLabel: { id: "settings.departments.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.departments.inUse",
    defaultMessage: "{count, plural, one {# reference} other {# references}}",
  },
  archive: { id: "settings.departments.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.departments.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.departments.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.departments.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.departments.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.departments.archiveWarning",
    defaultMessage:
      "Archive {name}? Existing user and Contract references keep this Department. It leaves every picker.",
  },
  reassignLabel: {
    id: "settings.departments.reassignLabel",
    defaultMessage:
      "Reassign {count, plural, =0 {references} one {# reference} other {# references}} to",
  },
  reassignNone: { id: "settings.departments.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.departments.noCandidates",
    defaultMessage: "Departments keep existing references when archived.",
  },
  auditNote: {
    id: "settings.departments.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.departments.archiveError",
    defaultMessage: "The Department could not be archived.",
  },
  archiveSubmit: { id: "settings.departments.archiveSubmit", defaultMessage: "Archive Department" },
});

const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const result = await api
      .POST("/api/v1/departments", { body: { displayName } })
      .catch(() => undefined);
    return { data: result?.data?.department, ...(await problem(result)) };
  },
  async rename(id, displayName) {
    const result = await api
      .PATCH("/api/v1/departments/{id}", {
        params: { path: { id } },
        body: { displayName },
      })
      .catch(() => undefined);
    return { data: result?.data?.department, ...(await problem(result)) };
  },
  async reorder(ids) {
    const result = await api
      .PUT("/api/v1/departments/order", { body: { ids } })
      .catch(() => undefined);
    return { data: result?.data?.departments, ...(await problem(result)) };
  },
  async archive(id, reassignToId) {
    const result = await api
      .POST("/api/v1/departments/{id}/archive", {
        params: { path: { id } },
        body: reassignToId ? { reassignToId } : {},
      })
      .catch(() => undefined);
    return { data: result?.data?.department, ...(await problem(result)) };
  },
  async restore(id) {
    const result = await api
      .POST("/api/v1/departments/{id}/restore", { params: { path: { id } } })
      .catch(() => undefined);
    return { data: result?.data?.department, ...(await problem(result)) };
  },
};

export function SettingsDepartmentsPage() {
  const { departments } = useLoaderData<typeof settingsDepartmentsLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={departments}
      tabs={null}
      archiveKeepsReferences
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
