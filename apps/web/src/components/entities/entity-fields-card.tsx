// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  commitsOnChange,
  sameDraft,
  toDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../../lib/custom-fields";
import type { EntityField, EntityRow } from "../../lib/entities";
import type { FieldStatus } from "../../lib/field-commit";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { StatusNote } from "../status-note";
import { Label } from "../ui/label";

export function EntityFieldsCard({
  entity,
  fields,
  people,
  entities,
  frozen,
  status,
  error,
  onCommit,
}: Readonly<{
  entity: EntityRow;
  fields: readonly EntityField[];
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  frozen: boolean;
  status: Readonly<Record<string, FieldStatus | undefined>>;
  error: Readonly<Record<string, string | undefined>>;
  onCommit: (slug: string, value: CustomFieldValue | null) => void;
}>) {
  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">
          <FormattedMessage id="entities.record.fields.title" defaultMessage="Fields" />
        </h2>
      </header>
      {fields.length === 0 ? (
        <p className="p-4 text-base text-muted">
          <FormattedMessage
            id="entities.record.fields.empty"
            defaultMessage="This Entity type has no Fields."
          />
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-2">
          {fields.map((field) => (
            <EntityFieldControl
              key={`${field.fieldId}:${JSON.stringify(entity.customFields[field.slug])}`}
              field={field}
              saved={entity.customFields[field.slug]}
              people={people}
              entities={entities}
              frozen={frozen}
              status={status[`field:${field.slug}`] ?? "idle"}
              error={error[`field:${field.slug}`]}
              onCommit={(value) => onCommit(field.slug, value)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EntityFieldControl({
  field,
  saved,
  people,
  entities,
  frozen,
  status,
  error,
  onCommit,
}: Readonly<{
  field: EntityField;
  saved: CustomFieldValue | undefined;
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  frozen: boolean;
  status: FieldStatus;
  error?: string;
  onCommit: (value: CustomFieldValue | null) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<CustomFieldDraft>(() => toDraft(field, saved));
  const id = `entity-field-${field.slug}`;

  function commit(next = draft) {
    if (sameDraft(next, toDraft(field, saved))) return;
    const converted = toValue(field, next);
    if ("error" in converted) return;
    onCommit(converted.value);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label id={`${id}-label`} htmlFor={id}>
        {field.displayName}
        {field.isRequired && !frozen ? (
          <span className="ms-0.5 text-status-danger-fg" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {frozen ? (
        <span>
          {saved === undefined
            ? intl.formatMessage({
                id: "entities.record.notRecorded",
                defaultMessage: "Not recorded",
              })
            : Array.isArray(saved)
              ? saved.join(", ")
              : String(saved)}
        </span>
      ) : (
        <CustomFieldControl
          id={id}
          field={field}
          draft={draft}
          people={people}
          entities={entities}
          describedBy={field.description ? `${id}-description` : undefined}
          required={field.isRequired}
          invalid={status === "error"}
          onDraft={(next) => {
            setDraft(next);
            if (commitsOnChange(field)) commit(next);
          }}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setDraft(toDraft(field, saved));
          }}
        />
      )}
      {field.description ? (
        <p id={`${id}-description`} className="text-sm text-muted">
          {field.description}
        </p>
      ) : null}
      {!frozen ? <StatusNote status={status} detail={error} /> : null}
    </div>
  );
}
