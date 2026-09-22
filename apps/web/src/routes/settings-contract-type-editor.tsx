// SPDX-License-Identifier: AGPL-3.0-only

/** The Contract type editor, with identity and the DD-028 Form on routed sections. */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages } from "react-intl";
import { api } from "../lib/api";
import { isFieldRow } from "../lib/field-catalog";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

import { ContractTypeApprovalDefault } from "../components/approval-default-settings";
import { ContractTypePeople } from "../components/contract-type-people";
import { TypeEditorSections, TypeEditorTabs } from "../components/type-editor-sections";
import { TypeFormBuilder } from "../components/type-form/builder";
import { TypeEditorScreen, type TypeEditorIdentityApi } from "../components/type-editor-screen";

export async function settingsContractTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, formRes, catalogRes, peopleRes, usersRes] = await Promise.all([
    api.GET("/api/v1/contract-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/contract-types/{id}/form", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
    api.GET("/api/v1/contract-types/{id}/people", { params: { path: { id } } }),
    api.GET("/api/v1/users"),
  ]);
  if (!typeRes.data || !formRes.data || !catalogRes.data || !peopleRes.data || !usersRes.data) {
    throw new Error("The contract type could not be read.");
  }
  return {
    contractType: typeRes.data.contractType,
    people: peopleRes.data.people,
    users: usersRes.data.users,
    form: formRes.data.form,
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
});

/** The shared editor's API seam over the contract-types routes. */
const EDITOR_API: TypeEditorIdentityApi = {
  async update(id, body) {
    const result = await api
      .PATCH("/api/v1/contract-types/{id}", {
        params: { path: { id } },
        body,
      })
      .catch(() => undefined);
    return { data: result?.data?.contractType, ...(await problem(result)) };
  },
};

export function SettingsContractTypeEditorPage() {
  const { contractType, form, catalog, people, users } =
    useLoaderData<typeof settingsContractTypeEditorLoader>();
  return (
    <TypeEditorScreen
      key={contractType.id}
      initialType={contractType}
      tabs={
        <TypeEditorTabs
          module="contract"
          typeId={contractType.id}
          name={contractType.displayName}
        />
      }
      backPath="/settings/contracts/types"
      api={EDITOR_API}
      messages={MESSAGES}
      sectionContent={
        <TypeEditorSections
          module="contract"
          form={
            <TypeFormBuilder
              module="contract"
              typeId={contractType.id}
              isDefault={contractType.isDefault}
              typeName={contractType.displayName}
              initialForm={form}
              catalog={catalog}
            />
          }
          people={
            <ContractTypePeople
              typeId={contractType.id}
              initialPeople={people}
              users={users}
              archived={contractType.archivedAt !== null}
            />
          }
          approval={
            <ContractTypeApprovalDefault
              typeId={contractType.id}
              archived={contractType.archivedAt !== null}
            />
          }
        />
      }
    />
  );
}
