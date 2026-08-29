// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entities · Officer roles: the fifth configuration of the shared
 * taxonomy pane. Usage includes current and resigned officer rows, so
 * the SET-003 reassignment guard presents the same set the API moves.
 */

import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { EntitiesSettingsTabs } from "../components/entities-settings-tabs";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

export async function settingsOfficerRolesLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/officer-roles", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The officer roles could not be read.");
  return { officerRoles: data.officerRoles };
}

const MESSAGES = defineMessages({
  pageTitle: { id: "settings.officerRoles.pageTitle", defaultMessage: "Officer roles" },
  title: { id: "settings.officerRoles.title", defaultMessage: "Officer roles" },
  count: {
    id: "settings.officerRoles.count",
    defaultMessage: "{count, plural, one {# role} other {# roles}}",
  },
  add: { id: "settings.officerRoles.add", defaultMessage: "Add role" },
  addName: { id: "settings.officerRoles.addName", defaultMessage: "New role name" },
  help: {
    id: "settings.officerRoles.help",
    defaultMessage:
      "Drag to reorder. Archiving a role in use asks for a replacement; Other can't be archived.",
  },
  renameLabel: { id: "settings.officerRoles.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.officerRoles.inUse",
    defaultMessage: "{count, plural, one {# officer} other {# officers}}",
  },
  locked: {
    id: "settings.officerRoles.locked",
    defaultMessage: "{name} is system-protected and can't be archived",
  },
  archive: { id: "settings.officerRoles.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.officerRoles.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.officerRoles.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.officerRoles.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.officerRoles.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.officerRoles.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {{name} is not used by any officers — it can be archived " +
      "without reassignment.} one {{name} is used by # officer. Pick a replacement " +
      "role — that officer moves to it when the role is archived.} other {{name} is used " +
      "by # officers. Pick a replacement role — those officers move to it when the role " +
      "is archived.}}",
  },
  reassignLabel: {
    id: "settings.officerRoles.reassignLabel",
    defaultMessage: "Reassign {count, plural, =0 {officers} one {# officer} other {# officers}} to",
  },
  reassignNone: { id: "settings.officerRoles.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.officerRoles.noCandidates",
    defaultMessage:
      "No other active role can take its officers. Add or restore another role first.",
  },
  auditNote: {
    id: "settings.officerRoles.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.officerRoles.archiveError",
    defaultMessage: "The role could not be archived.",
  },
  archiveSubmit: { id: "settings.officerRoles.archiveSubmit", defaultMessage: "Archive role" },
});

const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const result = await api
      .POST("/api/v1/officer-roles", { body: { displayName } })
      .catch(() => undefined);
    return { data: result?.data?.officerRole, ...(await problem(result)) };
  },
  async rename(id, displayName) {
    const result = await api
      .PATCH("/api/v1/officer-roles/{id}", {
        params: { path: { id } },
        body: { displayName },
      })
      .catch(() => undefined);
    return { data: result?.data?.officerRole, ...(await problem(result)) };
  },
  async reorder(ids) {
    const result = await api
      .PUT("/api/v1/officer-roles/order", { body: { ids } })
      .catch(() => undefined);
    return { data: result?.data?.officerRoles, ...(await problem(result)) };
  },
  async archive(id, reassignToId) {
    const result = await api
      .POST("/api/v1/officer-roles/{id}/archive", {
        params: { path: { id } },
        body: reassignToId ? { reassignToId } : {},
      })
      .catch(() => undefined);
    return { data: result?.data?.officerRole, ...(await problem(result)) };
  },
  async restore(id) {
    const result = await api
      .POST("/api/v1/officer-roles/{id}/restore", { params: { path: { id } } })
      .catch(() => undefined);
    return { data: result?.data?.officerRole, ...(await problem(result)) };
  },
};

export function SettingsOfficerRolesPage() {
  const { officerRoles } = useLoaderData<typeof settingsOfficerRolesLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={officerRoles}
      tabs={<EntitiesSettingsTabs />}
      protectedRow={{ slug: "other", label: MESSAGES.locked }}
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
