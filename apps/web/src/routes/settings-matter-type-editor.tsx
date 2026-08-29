// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The matter type editor (#85), the ST15 frame of settings.pen on the
 * shared TypeEditorScreen machinery — this file owns the MTR-011
 * vocabulary and the API adapter over the matter-types attachment
 * routes; the DES-022 behavior lives in the shared component, which is
 * the point: the matter editor is configuration, not a copy of the
 * contract one. The Attach menu offers matter-scoped and global fields.
 * The loader is the client half of SET-002's gate; the API's
 * 403 is the real refusal.
 */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { TypeEditorScreen, type TypeEditorApi } from "../components/type-editor-screen";

export async function settingsMatterTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
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
    catalog: catalogRes.data.fields.filter(
      (field) => field.moduleScope === "matter" || field.moduleScope === "global",
    ),
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
    defaultMessage: "Every eligible field is attached.",
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
    const result = await api
      .PATCH("/api/v1/matter-types/{id}", {
        params: { path: { id } },
        body,
      })
      .catch(() => undefined);
    return { data: result?.data?.matterType, ...(await problem(result)) };
  },
  async attach(id, fieldId) {
    const result = await api
      .POST("/api/v1/matter-types/{id}/fields", {
        params: { path: { id } },
        body: { fieldId },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async detach(id, fieldId) {
    const result = await api
      .DELETE("/api/v1/matter-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
      })
      .catch(() => undefined);
    return { ok: result?.response.ok === true, ...(await problem(result)) };
  },
  async setRequired(id, fieldId, isRequired) {
    const result = await api
      .PATCH("/api/v1/matter-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
        body: { isRequired },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async reorder(id, fieldIds) {
    const result = await api
      .PUT("/api/v1/matter-types/{id}/fields/order", {
        params: { path: { id } },
        body: { fieldIds },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedFields, ...(await problem(result)) };
  },
};

export function SettingsMatterTypeEditorPage() {
  const { matterType, attachedFields, catalog } =
    useLoaderData<typeof settingsMatterTypeEditorLoader>();
  return (
    <TypeEditorScreen
      initialType={matterType}
      tabs={<MattersSettingsTabs />}
      backPath="/settings/matters/types"
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
