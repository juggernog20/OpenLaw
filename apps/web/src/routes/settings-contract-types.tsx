// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Types (#81), the DES-020 list-editor's reference pane:
 * the CTR-002 taxonomy on the shared TaxonomyTypesPane machinery
 * (extracted with #85) — this file owns the CTR-002 vocabulary and the
 * API adapter over the contract-types routes; the behavior lives in
 * the shared component. The loader is the client half of SET-002's
 * gate; the API's 403 is the real refusal.
 */

import { redirect, useLoaderData } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { TaxonomyTypesPane, type TaxonomyPaneApi } from "../components/taxonomy-types-pane";

/** The section URL forwards to its first pane (SET-001 deep links). */
export function settingsContractsIndexLoader() {
  return redirect("/settings/contracts/types");
}

export async function settingsContractTypesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/contract-types", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The contract types could not be read.");
  return { contractTypes: data.contractTypes };
}

/** The CTR-002 vocabulary over the shared pane's message slots. */
const MESSAGES = defineMessages({
  pageTitle: { id: "settings.contractTypes.pageTitle", defaultMessage: "Contract types" },
  title: { id: "settings.contractTypes.title", defaultMessage: "Contract types" },
  count: {
    id: "settings.contractTypes.count",
    defaultMessage: "{count, plural, one {# type} other {# types}}",
  },
  add: { id: "settings.contractTypes.add", defaultMessage: "Add type" },
  addName: { id: "settings.contractTypes.addName", defaultMessage: "New type name" },
  help: {
    id: "settings.contractTypes.help",
    defaultMessage:
      "Drag to reorder. Archiving a type in use asks for a replacement; Other can't be archived.",
  },
  renameLabel: { id: "settings.contractTypes.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.contractTypes.inUse",
    defaultMessage: "{count, plural, one {# contract} other {# contracts}}",
  },
  edit: { id: "settings.contractTypes.edit", defaultMessage: "Edit {name}" },
  locked: {
    id: "settings.contractTypes.locked",
    defaultMessage: "{name} is system-protected and can't be archived",
  },
  archive: { id: "settings.contractTypes.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.contractTypes.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.contractTypes.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.contractTypes.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.contractTypes.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.contractTypes.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {{name} is not used by any contracts — it can be " +
      "archived without reassignment.} one {{name} is used by # contract. Pick a " +
      "replacement type — that contract moves to it when the type is archived.} " +
      "other {{name} is used by # contracts. Pick a replacement type — those " +
      "contracts move to it when the type is archived.}}",
  },
  reassignLabel: {
    id: "settings.contractTypes.reassignLabel",
    defaultMessage:
      "Reassign {count, plural, =0 {contracts} one {# contract} other {# contracts}} to",
  },
  reassignNone: { id: "settings.contractTypes.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.contractTypes.noCandidates",
    defaultMessage:
      "No other active type can take its contracts. Add or restore another type first.",
  },
  auditNote: {
    id: "settings.contractTypes.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.contractTypes.archiveError",
    defaultMessage: "The type could not be archived.",
  },
  archiveSubmit: { id: "settings.contractTypes.archiveSubmit", defaultMessage: "Archive type" },
});

/** The shared pane's API seam over the contract-types routes. */
const PANE_API: TaxonomyPaneApi = {
  async create(displayName) {
    const { data, error } = await api.POST("/api/v1/contract-types", { body: { displayName } });
    return { data: data?.contractType, detail: problemDetail(error) };
  },
  async rename(id, displayName) {
    const { data, error } = await api.PATCH("/api/v1/contract-types/{id}", {
      params: { path: { id } },
      body: { displayName },
    });
    return { data: data?.contractType, detail: problemDetail(error) };
  },
  async reorder(ids) {
    const { data, error } = await api.PUT("/api/v1/contract-types/order", { body: { ids } });
    return { data: data?.contractTypes, detail: problemDetail(error) };
  },
  async archive(id, reassignToId) {
    const { data, error } = await api.POST("/api/v1/contract-types/{id}/archive", {
      params: { path: { id } },
      body: reassignToId ? { reassignToId } : {},
    });
    return { data: data?.contractType, detail: problemDetail(error) };
  },
  async restore(id) {
    const { data, error } = await api.POST("/api/v1/contract-types/{id}/restore", {
      params: { path: { id } },
    });
    return { data: data?.contractType, detail: problemDetail(error) };
  },
};

export function SettingsContractTypesPage() {
  const { contractTypes } = useLoaderData<typeof settingsContractTypesLoader>();
  return (
    <TaxonomyTypesPane
      initialRows={contractTypes}
      tabs={<ContractsSettingsTabs />}
      editor={{ path: (row) => `/settings/contracts/types/${row.id}`, label: MESSAGES.edit }}
      api={PANE_API}
      messages={MESSAGES}
    />
  );
}
