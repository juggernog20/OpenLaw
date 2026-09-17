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
import { isFieldRow } from "../lib/field-catalog";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { ContractTypePeople } from "../components/contract-type-people";
import { TypeEditorScreen, type TypeEditorApi } from "../components/type-editor-screen";

export async function settingsContractTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, attachedRes, catalogRes, peopleRes, usersRes] = await Promise.all([
    api.GET("/api/v1/contract-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/contract-types/{id}/fields", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
    api.GET("/api/v1/contract-types/{id}/people", { params: { path: { id } } }),
    api.GET("/api/v1/users"),
  ]);
  if (!typeRes.data || !attachedRes.data || !catalogRes.data || !peopleRes.data || !usersRes.data) {
    throw new Error("The contract type could not be read.");
  }
  return {
    contractType: typeRes.data.contractType,
    people: peopleRes.data.people,
    users: usersRes.data.users,
    attachedFields: attachedRes.data.attachedFields,
    catalog: catalogRes.data.fields.filter((field) => isFieldRow(field, "contract")),
  };
}

/** The CTR-016 vocabulary over the shared editor's message slots. */
const MESSAGES = defineMessages({
  allTypes: { id: "settings.contractTypeEditor.allTypes", defaultMessage: "All types" },
  displayName: { id: "settings.contractTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.contractTypeEditor.description", defaultMessage: "Description" },
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
  help: {
    id: "settings.contractTypeEditor.help",
    defaultMessage:
      "Drag to reorder. Required fields are enforced at creation and re-type; detaching a field keeps stored values.",
  },
});

/** The shared editor's API seam over the contract-types routes. */
const EDITOR_API: TypeEditorApi = {
  async update(id, body) {
    const result = await api
      .PATCH("/api/v1/contract-types/{id}", {
        params: { path: { id } },
        body,
      })
      .catch(() => undefined);
    return { data: result?.data?.contractType, ...(await problem(result)) };
  },
  async attach(id, fieldId) {
    const result = await api
      .POST("/api/v1/contract-types/{id}/fields", {
        params: { path: { id } },
        body: { fieldId },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async detach(id, fieldId) {
    const result = await api
      .DELETE("/api/v1/contract-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
      })
      .catch(() => undefined);
    return { ok: result?.response.ok === true, ...(await problem(result)) };
  },
  async setRequired(id, fieldId, isRequired) {
    const result = await api
      .PATCH("/api/v1/contract-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
        body: { isRequired },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async reorder(id, fieldIds) {
    const result = await api
      .PUT("/api/v1/contract-types/{id}/fields/order", {
        params: { path: { id } },
        body: { fieldIds },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedFields, ...(await problem(result)) };
  },
};

export function SettingsContractTypeEditorPage() {
  const { contractType, attachedFields, catalog, people, users } =
    useLoaderData<typeof settingsContractTypeEditorLoader>();
  return (
    <TypeEditorScreen
      key={contractType.id}
      initialType={contractType}
      tabs={<ContractsSettingsTabs />}
      backPath="/settings/contracts/types"
      api={EDITOR_API}
      messages={MESSAGES}
      extraCards={
        <ContractTypePeople
          typeId={contractType.id}
          initialPeople={people}
          users={users}
          archived={contractType.archivedAt !== null}
        />
      }
      attachments={{
        createFieldModule: "contract",
        initialAttached: attachedFields,
        catalog,
        api: EDITOR_API,
        messages: MESSAGES,
      }}
    />
  );
}
