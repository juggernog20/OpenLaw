// SPDX-License-Identifier: AGPL-3.0-only
import {
  SEARCH_PROPERTIES,
  SEARCH_OPERATORS,
  searchProperty,
  type SearchQuestion,
} from "@openlaw/shared";
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { PropertyList } from "../table/property-list";
import { FilterEditor } from "../table/record-filter-bar";
import {
  operatorLabel,
  propertyLabel,
  useConditionDefinitions,
  type Condition,
} from "./condition-definitions";
import { searchKindLabel } from "./search-result-row";
import { CHIP_CLASS, IDLE_CHIP_CLASS, SELECTED_CHIP_CLASS } from "./search-question";
import { cn } from "../../lib/utils";

function ConditionRow({
  condition,
  choices,
  focus,
  onChange,
  onRemove,
}: Readonly<{
  condition: Condition;
  choices: { id: string; displayName: string }[];
  focus: boolean;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
}>) {
  const intl = useIntl();
  const row = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (focus) row.current?.focus();
  }, [focus]);
  const property = searchProperty(condition.kind, condition.property);
  if (!property) return null;
  const label = propertyLabel(intl, condition.kind, condition.property);
  const kind = searchKindLabel(intl, condition.kind);
  const values = Array.isArray(condition.value) ? (condition.value as string[]) : [];
  const inputLabel = intl.formatMessage({ id: "search.condition.value", defaultMessage: "Value" });
  const setValue = (value: Condition["value"]) => onChange({ ...condition, value });
  return (
    <div
      ref={row}
      tabIndex={-1}
      role="group"
      aria-label={intl.formatMessage(
        { id: "search.condition.row", defaultMessage: "{kind} {property} condition" },
        { kind, property: label },
      )}
      className="space-y-2 rounded-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {kind}: {label}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={intl.formatMessage(
            { id: "search.condition.remove", defaultMessage: "Remove {kind} {property} condition" },
            { kind, property: label },
          )}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 @xl/dialog:grid-cols-2">
        <select
          className={CONTROL_CLASS}
          aria-label={intl.formatMessage({
            id: "search.condition.operator",
            defaultMessage: "Operator",
          })}
          value={condition.operator}
          onChange={(event) => {
            const operator = event.target.value;
            onChange({
              ...condition,
              operator,
              value:
                property.type === "date"
                  ? operator === "between"
                    ? [
                        typeof condition.value === "string" ? condition.value : (values[0] ?? ""),
                        values[1] ?? "",
                      ]
                    : (values[0] ?? condition.value)
                  : condition.value,
            });
          }}
        >
          {SEARCH_OPERATORS[property.type].map((operator) => (
            <option key={operator} value={operator}>
              {operatorLabel(intl, operator)}
            </option>
          ))}
        </select>
        {property.type === "choices" ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                className="min-w-0 justify-start truncate"
                aria-label={intl.formatMessage({
                  id: "search.condition.choose",
                  defaultMessage: "Choose values",
                })}
              >
                <span className="truncate">
                  {values.length
                    ? values
                        .map(
                          (value) =>
                            choices.find((choice) => choice.id === value)?.displayName ?? value,
                        )
                        .join(", ")
                    : intl.formatMessage({
                        id: "search.condition.choose",
                        defaultMessage: "Choose values",
                      })}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label={label}>
              <FilterEditor
                filter={{ key: condition.property, label, kind: "choices", choices }}
                values={{ [condition.property]: values.join(",") }}
                onApply={(next) => {
                  setValue(
                    String(next[condition.property] ?? "")
                      .split(",")
                      .filter(Boolean),
                  );
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        ) : property.type === "flag" ? (
          <select
            className={CONTROL_CLASS}
            aria-label={inputLabel}
            value={String(condition.value)}
            onChange={(e) => setValue(e.target.value === "true")}
          >
            <option value="true">
              {intl.formatMessage({ id: "search.condition.yes", defaultMessage: "Yes" })}
            </option>
            <option value="false">
              {intl.formatMessage({ id: "search.condition.no", defaultMessage: "No" })}
            </option>
          </select>
        ) : property.type === "date" && condition.operator === "between" ? (
          <div className="flex min-w-0 gap-2">
            <Input
              type="date"
              aria-label={intl.formatMessage({ id: "recordFilters.from", defaultMessage: "From" })}
              value={values[0] ?? ""}
              min="0001-01-01"
              max={values[1] || "9999-12-31"}
              onChange={(e) => setValue([e.target.value, values[1] ?? ""])}
            />
            <Input
              type="date"
              aria-label={intl.formatMessage({ id: "recordFilters.to", defaultMessage: "To" })}
              value={values[1] ?? ""}
              min={values[0] || "0001-01-01"}
              max="9999-12-31"
              onChange={(e) => setValue([values[0] ?? "", e.target.value])}
            />
          </div>
        ) : (
          <Input
            aria-label={inputLabel}
            type={property.type === "date" ? "date" : "text"}
            value={typeof condition.value === "string" ? condition.value : ""}
            min={property.type === "date" ? "0001-01-01" : undefined}
            max={property.type === "date" ? "9999-12-31" : undefined}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

export function SearchConditions({
  question,
  onChange,
  focusCondition,
}: Readonly<{
  question: SearchQuestion;
  onChange: (question: SearchQuestion) => void;
  focusCondition?: number;
}>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const { choices, error } = useConditionDefinitions(question.kinds);
  const properties = SEARCH_PROPERTIES.filter((property) => question.kinds.includes(property.kind));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          <FormattedMessage id="search.properties" defaultMessage="Properties" />
        </h2>
        {properties.length > 0 && (
          <div
            className="flex gap-1"
            role="group"
            aria-label={intl.formatMessage({
              id: "search.match",
              defaultMessage: "Match conditions",
            })}
          >
            {(["all", "any"] as const).map((match) => (
              <button
                key={match}
                type="button"
                aria-pressed={question.match === match}
                className={cn(
                  CHIP_CLASS,
                  question.match === match ? SELECTED_CHIP_CLASS : IDLE_CHIP_CLASS,
                )}
                onClick={() => onChange({ ...question, match })}
              >
                {match === "all" ? (
                  <FormattedMessage id="search.match.all" defaultMessage="Match all" />
                ) : (
                  <FormattedMessage id="search.match.any" defaultMessage="Match any" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {question.conditions.map((condition, index) => (
        <ConditionRow
          key={`${condition.kind}:${condition.property}:${index}`}
          condition={condition}
          choices={choices(condition)}
          focus={focusCondition === index}
          onChange={(next) =>
            onChange({
              ...question,
              conditions: question.conditions.map((row, at) => (at === index ? next : row)),
            })
          }
          onRemove={() => {
            setLimitError(false);
            onChange({
              ...question,
              conditions: question.conditions.filter((_, at) => at !== index),
            });
          }}
        />
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next && question.conditions.length >= 20) {
            setLimitError(true);
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" disabled={!properties.length}>
            <Plus size={14} aria-hidden="true" />
            <FormattedMessage id="search.condition.add" defaultMessage="Add condition" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0">
          <PropertyList
            searchLabel={intl.formatMessage({
              id: "search.properties.search",
              defaultMessage: "Search properties",
            })}
            items={properties.map((property) => ({
              key: `${property.kind}:${property.key}`,
              label: propertyLabel(intl, property.kind, property.key),
              group: intl.formatMessage(
                { id: "search.properties.group", defaultMessage: "{kind} properties" },
                { kind: searchKindLabel(intl, property.kind) },
              ),
            }))}
            onSelect={(key) => {
              const property = properties.find(
                (property) => `${property.kind}:${property.key}` === key,
              )!;
              if (question.conditions.length >= 20) {
                setLimitError(true);
                setOpen(false);
                return;
              }
              onChange({
                ...question,
                conditions: [
                  ...question.conditions,
                  {
                    kind: property.kind,
                    property: property.key,
                    operator: SEARCH_OPERATORS[property.type][0],
                    value: property.type === "flag" ? true : property.type === "choices" ? [] : "",
                  },
                ],
              });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {limitError && question.conditions.length >= 20 && (
        <p role="alert" className="text-sm text-status-danger-fg">
          <FormattedMessage
            id="search.condition.limit"
            defaultMessage="A search can have at most 20 conditions."
          />
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
    </section>
  );
}
