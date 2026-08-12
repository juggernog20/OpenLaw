// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The matter type editor (#85), the ST15 frame of settings.pen on the
 * shared TypeEditorScreen machinery — this file owns the MTR-011
 * vocabulary and the API adapter over the matter-types attachment
 * routes; the DES-022 behavior lives in the shared component, which is
 * the point: the matter editor is configuration, not a copy of the
 * contract one. The Attach menu offers global-tier fields only — the
 * matter-scope Fields view ships with the matter record milestone
 * (M22). The loader is the client half of SET-002's gate; the API's
 * 403 is the real refusal.
 */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { TypeEditorScreen, type TypeEditorApi } from "../components/type-editor-screen";

export async function settingsMatterTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, attachedRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/matter-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/matter-types/{id}/fields", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !attachedRes.data || !catalogRes.data) {
    throw new Error("The matter type could not be read.");
  }
  return {
    matterType: typeRes.data.matterType,
    attachedFields: attachedRes.data.attachedFields,
    // The MTR-011 scope rule until M22: the Attach menu offers only the
    // global tier — the API refuses everything else anyway.
    catalog: catalogRes.data.fields.filter((field) => field.moduleScope === "global"),
  };
}

/** The MTR-011 vocabulary over the shared editor's message slots. */
const MESSAGES = defineMessages({
  allTypes: { id: "settings.matterTypeEditor.allTypes", defaultMessage: "All types" },
  displayName: { id: "settings.matterTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.matterTypeEditor.description", defaultMessage: "Description" },
  slug: { id: "settings.matterTypeEditor.slug", defaultMessage: "Slug" },
  slugNote: {
    id: "settings.matterTypeEditor.slugNote",
    defaultMessage: "Slug is immutable — it keys templates, reporting, and the API.",
  },
  inUse: {
    id: "settings.matterTypeEditor.inUse",
    defaultMessage:
      "{count, plural, one {# matter uses this type.} other {# matters use this type.}}",
  },
  attachedFields: {
    id: "settings.matterTypeEditor.attachedFields",
    defaultMessage: "Attached fields",
  },
  fieldColumn: { id: "settings.matterTypeEditor.fieldColumn", defaultMessage: "Field" },
  requiredColumn: {
    id: "settings.matterTypeEditor.requiredColumn",
    defaultMessage: "Required",
  },
  requiredFor: {
    id: "settings.matterTypeEditor.requiredFor",
    defaultMessage: "{name} required",
  },
  detach: { id: "settings.matterTypeEditor.detach", defaultMessage: "Detach {name}" },
  detached: { id: "settings.matterTypeEditor.detached", defaultMessage: "{name} detached." },
  attach: { id: "settings.matterTypeEditor.attach", defaultMessage: "Attach field" },
  attached: { id: "settings.matterTypeEditor.attached", defaultMessage: "{name} attached." },
  allAttached: {
    id: "settings.matterTypeEditor.allAttached",
    defaultMessage: "Every global field is attached.",
  },
  empty: {
    id: "settings.matterTypeEditor.empty",
    defaultMessage: "No fields are attached to this type.",
  },
  reorder: {
    id: "settings.matterTypeEditor.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.matterTypeEditor.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  globalCaption: {
    id: "settings.matterTypeEditor.globalCaption",
    defaultMessage: "{type} · global",
  },
  help: {
    id: "settings.matterTypeEditor.help",
    defaultMessage:
      "Drag to reorder. Required fields are enforced at creation and re-type; detaching a field keeps stored values.",
  },
});

/** The shared editor's API seam over the matter-types routes. */
const EDITOR_API: TypeEditorApi = {
  async update(id, body) {
    const { data, error } = await api.PATCH("/api/v1/matter-types/{id}", {
      params: { path: { id } },
      body,
    });
    return { data: data?.matterType, detail: problemDetail(error) };
  },
  async attach(id, fieldId) {
    const { data, error } = await api.POST("/api/v1/matter-types/{id}/fields", {
      params: { path: { id } },
      body: { fieldId },
    });
    return { data: data?.attachedField, detail: problemDetail(error) };
  },
  async detach(id, fieldId) {
    const { error, response } = await api.DELETE("/api/v1/matter-types/{id}/fields/{fieldId}", {
      params: { path: { id, fieldId } },
    });
    return { ok: response?.ok === true, detail: problemDetail(error) };
  },
  async setRequired(id, fieldId, isRequired) {
    const { data, error } = await api.PATCH("/api/v1/matter-types/{id}/fields/{fieldId}", {
      params: { path: { id, fieldId } },
      body: { isRequired },
    });
    return { data: data?.attachedField, detail: problemDetail(error) };
  },
  async reorder(id, fieldIds) {
    const { data, error } = await api.PUT("/api/v1/matter-types/{id}/fields/order", {
      params: { path: { id } },
      body: { fieldIds },
    });
    return { data: data?.attachedFields, detail: problemDetail(error) };
  },
};

export function SettingsMatterTypeEditorPage() {
  const { matterType, attachedFields, catalog } =
    useLoaderData<typeof settingsMatterTypeEditorLoader>();
  return (
    <TypeEditorScreen
      initialType={matterType}
      initialAttached={attachedFields}
      catalog={catalog}
      tabs={<MattersSettingsTabs />}
      backPath="/settings/matters/types"
      api={EDITOR_API}
      messages={MESSAGES}
    />
  );
}
