// SPDX-License-Identifier: AGPL-3.0-only

/** The Matter type editor, with identity and the DD-028 Form on routed sections. */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

import { TypeEditorSections, TypeEditorTabs } from "../components/type-editor-sections";
import { TypeFormBuilder } from "../components/type-form/builder";
import { TypeEditorScreen, type TypeEditorIdentityApi } from "../components/type-editor-screen";

export async function settingsMatterTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, formRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/matter-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/matter-types/{id}/form", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !formRes.data || !catalogRes.data) {
    throw new Error("The matter type could not be read.");
  }
  return {
    matterType: typeRes.data.matterType,
    form: formRes.data.form,
    catalog: catalogRes.data.fields.filter((field) => field.moduleScope === "matter"),
  };
}

/** The MTR-011 vocabulary over the shared editor's message slots. */
const MESSAGES = defineMessages({
  allTypes: { id: "settings.matterTypeEditor.allTypes", defaultMessage: "All types" },
  displayName: { id: "settings.matterTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.matterTypeEditor.description", defaultMessage: "Description" },
  inUse: {
    id: "settings.matterTypeEditor.inUse",
    defaultMessage:
      "{count, plural, one {# matter uses this type.} other {# matters use this type.}}",
  },
});

/** The shared editor's API seam over the matter-types routes. */
const EDITOR_API: TypeEditorIdentityApi = {
  async update(id, body) {
    const result = await api
      .PATCH("/api/v1/matter-types/{id}", {
        params: { path: { id } },
        body,
      })
      .catch(() => undefined);
    return { data: result?.data?.matterType, ...(await problem(result)) };
  },
};

export function SettingsMatterTypeEditorPage() {
  const { matterType, form, catalog } = useLoaderData<typeof settingsMatterTypeEditorLoader>();
  return (
    <TypeEditorScreen
      initialType={matterType}
      tabs={<TypeEditorTabs module="matter" typeId={matterType.id} name={matterType.displayName} />}
      backPath="/settings/matters/types"
      api={EDITOR_API}
      messages={MESSAGES}
      sectionContent={
        <TypeEditorSections
          module="matter"
          form={
            <TypeFormBuilder
              module="matter"
              typeId={matterType.id}
              isDefault={matterType.isDefault}
              typeName={matterType.displayName}
              initialForm={form}
              catalog={catalog}
            />
          }
        />
      }
    />
  );
}
