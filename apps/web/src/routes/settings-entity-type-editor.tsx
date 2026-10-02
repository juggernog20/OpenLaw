// SPDX-License-Identifier: AGPL-3.0-only

/** The Entity type editor, with identity and the DD-028 Form on routed sections. */

import { useState } from "react";
import { REGISTER_KINDS, registerKindLabels, type RegisterKind } from "../lib/register-kind";
import { CONTROL_CLASS } from "../lib/form-controls";
import { Label } from "../components/ui/label";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import { TypeEditorSections, TypeEditorTabs } from "../components/type-editor-sections";
import { TypeFormBuilder } from "../components/type-form/builder";
import { TypeEditorScreen, type TypeEditorIdentityApi } from "../components/type-editor-screen";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

export async function settingsEntityTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, formRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/entity-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/entity-types/{id}/form", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !formRes.data || !catalogRes.data) {
    throw new Error("The entity type could not be read.");
  }
  return {
    entityType: typeRes.data.entityType,
    form: formRes.data.form,
    catalog: catalogRes.data.fields.filter((field) => field.moduleScope === "entity"),
  };
}

const MESSAGES = defineMessages({
  allTypes: { id: "settings.entityTypeEditor.allTypes", defaultMessage: "All types" },
  displayName: { id: "settings.entityTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.entityTypeEditor.description", defaultMessage: "Description" },
  inUse: {
    id: "settings.entityTypeEditor.inUse",
    defaultMessage:
      "{count, plural, one {# entity uses this type.} other {# entities use this type.}}",
  },
});

const EDITOR_API: TypeEditorIdentityApi = {
  async update(id, body) {
    const result = await api
      .PATCH("/api/v1/entity-types/{id}", { params: { path: { id } }, body })
      .catch(() => undefined);
    return { data: result?.data?.entityType, ...(await problem(result)) };
  },
};

function RegisterSelect({
  id,
  initial,
  disabled,
}: {
  id: string;
  initial: RegisterKind;
  disabled: boolean;
}) {
  const intl = useIntl();
  const [kind, setKind] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(registerKind: RegisterKind) {
    setBusy(true);
    setError(null);
    const result = await api
      .PATCH("/api/v1/entity-types/{id}", { params: { path: { id } }, body: { registerKind } })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) setKind(result.data.entityType.registerKind);
    else
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "settings.entityTypeEditor.registerError",
            defaultMessage: "The register could not be changed.",
          }),
      );
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="type-register">
        <FormattedMessage id="entities.registerKind.field" defaultMessage="Register" />
      </Label>
      <select
        id="type-register"
        value={kind}
        disabled={disabled || busy}
        className={CONTROL_CLASS}
        onChange={(e) => void save(e.target.value as RegisterKind)}
      >
        {REGISTER_KINDS.map((k) => (
          <option key={k} value={k}>
            {intl.formatMessage(registerKindLabels[k])}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-status-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsEntityTypeEditorPage() {
  const { entityType, form, catalog } = useLoaderData<typeof settingsEntityTypeEditorLoader>();
  return (
    <TypeEditorScreen
      initialType={entityType}
      tabs={<TypeEditorTabs module="entity" typeId={entityType.id} name={entityType.displayName} />}
      backPath="/settings/entities/types"
      api={EDITOR_API}
      messages={MESSAGES}
      identityExtra={
        <RegisterSelect
          key={entityType.id}
          id={entityType.id}
          initial={entityType.registerKind}
          disabled={entityType.archivedAt !== null}
        />
      }
      sectionContent={
        <TypeEditorSections
          module="entity"
          form={
            <TypeFormBuilder
              module="entity"
              typeId={entityType.id}
              typeName={entityType.displayName}
              initialForm={form}
              catalog={catalog}
            />
          }
        />
      }
    />
  );
}
