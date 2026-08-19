// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract type editor (#84), the ST16 frame of settings.pen on
 * the shared TypeEditorScreen machinery (extracted with #85) — this
 * file owns the CTR-016 vocabulary and the API adapter over the
 * contract-types attachment routes; the DES-022 behavior lives in the
 * shared component. The loader is the client half of SET-002's gate;
 * the API's 403 is the real refusal.
 */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { TypeEditorScreen, type TypeEditorApi } from "../components/type-editor-screen";

export async function settingsContractTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, attachedRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/contract-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/contract-types/{id}/fields", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !attachedRes.data || !catalogRes.data) {
    throw new Error("The contract type could not be read.");
  }
  return {
    contractType: typeRes.data.contractType,
    attachedFields: attachedRes.data.attachedFields,
    catalog: catalogRes.data.fields,
  };
}

/** The CTR-016 vocabulary over the shared editor's message slots. */
const MESSAGES = defineMessages({
  allTypes: { id: "settings.contractTypeEditor.allTypes", defaultMessage: "All types" },
  displayName: { id: "settings.contractTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.contractTypeEditor.description", defaultMessage: "Description" },
  slug: { id: "settings.contractTypeEditor.slug", defaultMessage: "Slug" },
  slugNote: {
    id: "settings.contractTypeEditor.slugNote",
    defaultMessage: "Slug is immutable — it keys templates, approval rules, and the API.",
  },
  inUse: {
    id: "settings.contractTypeEditor.inUse",
    defaultMessage:
      "{count, plural, one {# contract uses this type.} other {# contracts use this type.}}",
  },
  attachedFields: {
    id: "settings.contractTypeEditor.attachedFields",
    defaultMessage: "Attached fields",
  },
  fieldColumn: { id: "settings.contractTypeEditor.fieldColumn", defaultMessage: "Field" },
  requiredColumn: {
    id: "settings.contractTypeEditor.requiredColumn",
    defaultMessage: "Required",
  },
  requiredFor: {
    id: "settings.contractTypeEditor.requiredFor",
    defaultMessage: "{name} required",
  },
  detach: { id: "settings.contractTypeEditor.detach", defaultMessage: "Detach {name}" },
  detached: { id: "settings.contractTypeEditor.detached", defaultMessage: "{name} detached." },
  attach: { id: "settings.contractTypeEditor.attach", defaultMessage: "Attach field" },
  attached: { id: "settings.contractTypeEditor.attached", defaultMessage: "{name} attached." },
  allAttached: {
    id: "settings.contractTypeEditor.allAttached",
    defaultMessage: "Every catalog field is attached.",
  },
  empty: {
    id: "settings.contractTypeEditor.empty",
    defaultMessage: "No fields are attached to this type.",
  },
  reorder: {
    id: "settings.contractTypeEditor.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.contractTypeEditor.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  globalCaption: {
    id: "settings.contractTypeEditor.globalCaption",
    defaultMessage: "{type} · global",
  },
  help: {
    id: "settings.contractTypeEditor.help",
    defaultMessage:
      "Drag to reorder. Required fields are enforced at creation and re-type; detaching a field keeps stored values.",
  },
});

/** The shared editor's API seam over the contract-types routes. */
const EDITOR_API: TypeEditorApi = {
  async update(id, body) {
    const { data, error } = await api.PATCH("/api/v1/contract-types/{id}", {
      params: { path: { id } },
      body,
    });
    return { data: data?.contractType, detail: problemDetail(error) };
  },
  async attach(id, fieldId) {
    const { data, error } = await api.POST("/api/v1/contract-types/{id}/fields", {
      params: { path: { id } },
      body: { fieldId },
    });
    return { data: data?.attachedField, detail: problemDetail(error) };
  },
  async detach(id, fieldId) {
    const { error, response } = await api.DELETE("/api/v1/contract-types/{id}/fields/{fieldId}", {
      params: { path: { id, fieldId } },
    });
    return { ok: response?.ok === true, detail: problemDetail(error) };
  },
  async setRequired(id, fieldId, isRequired) {
    const { data, error } = await api.PATCH("/api/v1/contract-types/{id}/fields/{fieldId}", {
      params: { path: { id, fieldId } },
      body: { isRequired },
    });
    return { data: data?.attachedField, detail: problemDetail(error) };
  },
  async reorder(id, fieldIds) {
    const { data, error } = await api.PUT("/api/v1/contract-types/{id}/fields/order", {
      params: { path: { id } },
      body: { fieldIds },
    });
    return { data: data?.attachedFields, detail: problemDetail(error) };
  },
};

export function SettingsContractTypeEditorPage() {
  const { contractType, attachedFields, catalog } =
    useLoaderData<typeof settingsContractTypeEditorLoader>();
  return (
    <TypeEditorScreen
      initialType={contractType}
      tabs={<ContractsSettingsTabs />}
      backPath="/settings/contracts/types"
      api={EDITOR_API}
      messages={MESSAGES}
      attachments={{
        initialAttached: attachedFields,
        catalog,
        api: EDITOR_API,
        messages: MESSAGES,
      }}
    />
  );
}
