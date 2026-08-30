// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity record's Fields card: the custom Fields the Entity type
 * attaches (ENT-001), each committed on its own per DES-017.
 *
 * A control keeps its draft while other Fields commit. It reseeds the
 * draft only when the saved value it was seeded from changes by
 * content, never by object identity, so a fresh row from another
 * Field's commit does not discard a half-typed entry here. A draft the
 * client can refuse for itself (a number that is not a number) never
 * leaves the card. The refusal shows beside the control until the next
 * commit or Escape clears it.
 */

import { useState } from "react";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
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
import { formatFullDate } from "../../lib/format";
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
              key={field.fieldId}
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
  // The value the draft was last seeded from, compared by content. A
  // stable key keeps the control mounted, so focus survives a commit.
  const [seed, setSeed] = useState(() => JSON.stringify(saved ?? null));
  const seeded = JSON.stringify(saved ?? null);
  if (seed !== seeded) {
    setSeed(seeded);
    setDraft(toDraft(field, saved));
  }
  // A refusal the card raised itself, without a request. It overrides
  // the commit status until the next commit or Escape.
  const [refusal, setRefusal] = useState<string>();
  const id = `entity-field-${field.slug}`;

  function revert() {
    setDraft(toDraft(field, saved));
    setRefusal(undefined);
  }

  function commit(next = draft) {
    if (sameDraft(next, toDraft(field, saved))) {
      setRefusal(undefined);
      return;
    }
    const converted = toValue(field, next);
    if ("error" in converted) {
      setRefusal(
        intl.formatMessage({
          id: "entities.record.fields.numberInvalid",
          defaultMessage: "Enter this as a number.",
        }),
      );
      return;
    }
    setRefusal(undefined);
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
        <span>{savedLabel(intl, field, saved, people, entities)}</span>
      ) : (
        <CustomFieldControl
          id={id}
          field={field}
          draft={draft}
          people={people}
          entities={entities}
          describedBy={field.description ? `${id}-description` : undefined}
          required={field.isRequired}
          invalid={refusal !== undefined || status === "error"}
          onDraft={(next) => {
            setDraft(next);
            if (commitsOnChange(field)) commit(next);
          }}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") revert();
          }}
        />
      )}
      {field.description ? (
        <p id={`${id}-description`} className="text-sm text-muted">
          {field.description}
        </p>
      ) : null}
      {!frozen ? (
        <StatusNote status={refusal === undefined ? status : "error"} detail={refusal ?? error} />
      ) : null}
    </div>
  );
}

/**
 * The archived (read-only) rendering of one saved value. A reference
 * resolves to the name the record already holds, a date goes through
 * `Intl`, and a boolean reads as a word, so an archived Entity shows
 * what the editable view showed and never a stored id or "true".
 */
function savedLabel(
  intl: IntlShape,
  field: EntityField,
  saved: CustomFieldValue | undefined,
  people: readonly FieldReference[],
  entities: readonly FieldReference[],
): string {
  if (saved === undefined) {
    return intl.formatMessage({
      id: "entities.record.notRecorded",
      defaultMessage: "Not recorded",
    });
  }
  if (Array.isArray(saved)) return intl.formatList(saved, { type: "conjunction" });
  if (typeof saved === "boolean") {
    return saved
      ? intl.formatMessage({ id: "entities.record.fields.yes", defaultMessage: "Yes" })
      : intl.formatMessage({ id: "entities.record.fields.no", defaultMessage: "No" });
  }
  if (typeof saved === "number") return intl.formatNumber(saved);
  if (field.fieldType === "date") return formatFullDate(saved);
  if (field.fieldType === "user") return people.find((row) => row.id === saved)?.label ?? saved;
  if (field.fieldType === "entity") {
    const match = entities.find((row) => row.id === saved);
    if (match?.restricted) {
      return intl.formatMessage({ id: "entities.restricted", defaultMessage: "Restricted Entity" });
    }
    return match?.label ?? saved;
  }
  return saved;
}
