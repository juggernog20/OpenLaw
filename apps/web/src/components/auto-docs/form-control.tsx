// SPDX-License-Identifier: AGPL-3.0-only

/** Shared labelled answers for Member and Portal Generation forms. */
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { useIntl } from "react-intl";
import type { AutoDocGenerationForm } from "../../lib/auto-docs";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { DatePicker } from "../date-picker";

export type Draft = Record<string, string | string[]>;
export function FormControl({
  field,
  form,
  draft,
  onChange,
}: {
  field: AutoDocGenerationForm["fields"][number];
  form: Pick<AutoDocGenerationForm, "entities">;
  draft: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const intl = useIntl();
  const props = {
    id: `answer-${field.slug}`,
    required: field.required,
    "aria-describedby": field.help ? `help-${field.slug}` : undefined,
    className: CONTROL_CLASS,
  };
  if (field.fieldType === "date")
    return (
      <>
        <DatePicker
          id={props.id}
          describedBy={
            [props["aria-describedby"], field.required ? `required-${field.slug}` : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          value={String(draft)}
          onChange={onChange}
        />
        {field.required && (
          <span id={`required-${field.slug}`} className="sr-only">
            {intl.formatMessage({ id: "autoDocs.requiredAnswer", defaultMessage: "Required" })}
          </span>
        )}
      </>
    );
  if (field.fieldType === "long_text")
    return (
      <AutoResizeTextarea
        {...props}
        className={TEXTAREA_CLASS}
        value={String(draft)}
        onChange={(event) => onChange(event.target.value)}
        maxLength={10_000}
      />
    );
  if (field.fieldType === "multi_select")
    return (
      <select
        {...props}
        multiple
        value={Array.isArray(draft) ? draft : []}
        onChange={(event) =>
          onChange([...event.target.selectedOptions].map((option) => option.value))
        }
        className={`${CONTROL_CLASS} h-auto min-h-24`}
      >
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  if (["single_select", "boolean", "entity"].includes(field.fieldType))
    return (
      <select {...props} value={String(draft)} onChange={(event) => onChange(event.target.value)}>
        <option value="">
          {intl.formatMessage({ id: "autoDocs.chooseAnswer", defaultMessage: "Choose an answer" })}
        </option>
        {field.fieldType === "boolean" ? (
          <>
            <option value="true">
              {intl.formatMessage({ id: "common.yes", defaultMessage: "Yes" })}
            </option>
            <option value="false">
              {intl.formatMessage({ id: "common.no", defaultMessage: "No" })}
            </option>
          </>
        ) : field.fieldType === "entity" ? (
          form.entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))
        ) : (
          field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))
        )}
      </select>
    );
  return (
    <input
      {...props}
      type={field.fieldType === "number" || field.fieldType === "currency" ? "number" : "text"}
      step="any"
      maxLength={field.fieldType === "text" ? 500 : undefined}
      value={String(draft)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
