// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity type editor configures the shared TypeEditorScreen. Its
 * attachment catalog contains Entity-scoped and global Fields only.
 */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages } from "react-intl";
import { EntitiesSettingsTabs } from "../components/entities-settings-tabs";
import { TypeEditorScreen, type TypeEditorApi } from "../components/type-editor-screen";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

export async function settingsEntityTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, attachedRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/entity-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/entity-types/{id}/fields", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !attachedRes.data || !catalogRes.data) {
    throw new Error("The entity type could not be read.");
  }
  return {
    entityType: typeRes.data.entityType,
    attachedFields: attachedRes.data.attachedFields,
    catalog: catalogRes.data.fields.filter(
      (field) => field.moduleScope === "entity" || field.moduleScope === "global",
    ),
  };
}

const MESSAGES = defineMessages({
  allTypes: { id: "settings.entityTypeEditor.allTypes", defaultMessage: "All types" },
  displayName: { id: "settings.entityTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.entityTypeEditor.description", defaultMessage: "Description" },
  slug: { id: "settings.entityTypeEditor.slug", defaultMessage: "Slug" },
  slugNote: {
    id: "settings.entityTypeEditor.slugNote",
    defaultMessage: "Slug is immutable — it keys reporting and the API.",
  },
  inUse: {
    id: "settings.entityTypeEditor.inUse",
    defaultMessage:
      "{count, plural, one {# entity uses this type.} other {# entities use this type.}}",
  },
  attachedFields: {
    id: "settings.entityTypeEditor.attachedFields",
    defaultMessage: "Attached fields",
  },
  fieldColumn: { id: "settings.entityTypeEditor.fieldColumn", defaultMessage: "Field" },
  requiredColumn: { id: "settings.entityTypeEditor.requiredColumn", defaultMessage: "Required" },
  requiredFor: {
    id: "settings.entityTypeEditor.requiredFor",
    defaultMessage: "{name} required",
  },
  detach: { id: "settings.entityTypeEditor.detach", defaultMessage: "Detach {name}" },
  detached: { id: "settings.entityTypeEditor.detached", defaultMessage: "{name} detached." },
  attach: { id: "settings.entityTypeEditor.attach", defaultMessage: "Attach field" },
  attached: { id: "settings.entityTypeEditor.attached", defaultMessage: "{name} attached." },
  allAttached: {
    id: "settings.entityTypeEditor.allAttached",
    defaultMessage: "Every eligible field is attached.",
  },
  empty: {
    id: "settings.entityTypeEditor.empty",
    defaultMessage: "No fields are attached to this type.",
  },
  reorder: {
    id: "settings.entityTypeEditor.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.entityTypeEditor.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  globalCaption: {
    id: "settings.entityTypeEditor.globalCaption",
    defaultMessage: "{type} · global",
  },
  help: {
    id: "settings.entityTypeEditor.help",
    defaultMessage:
      "Drag to reorder. Required fields are enforced at creation and re-type; detaching a field keeps stored values.",
  },
});

const EDITOR_API: TypeEditorApi = {
  async update(id, body) {
    const result = await api
      .PATCH("/api/v1/entity-types/{id}", { params: { path: { id } }, body })
      .catch(() => undefined);
    return { data: result?.data?.entityType, ...(await problem(result)) };
  },
  async attach(id, fieldId) {
    const result = await api
      .POST("/api/v1/entity-types/{id}/fields", {
        params: { path: { id } },
        body: { fieldId },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async detach(id, fieldId) {
    const result = await api
      .DELETE("/api/v1/entity-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
      })
      .catch(() => undefined);
    return { ok: result?.response.ok === true, ...(await problem(result)) };
  },
  async setRequired(id, fieldId, isRequired) {
    const result = await api
      .PATCH("/api/v1/entity-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
        body: { isRequired },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async reorder(id, fieldIds) {
    const result = await api
      .PUT("/api/v1/entity-types/{id}/fields/order", {
        params: { path: { id } },
        body: { fieldIds },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedFields, ...(await problem(result)) };
  },
};

export function SettingsEntityTypeEditorPage() {
  const { entityType, attachedFields, catalog } =
    useLoaderData<typeof settingsEntityTypeEditorLoader>();
  return (
    <TypeEditorScreen
      initialType={entityType}
      tabs={<EntitiesSettingsTabs />}
      backPath="/settings/entities/types"
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
