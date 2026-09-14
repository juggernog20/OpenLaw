// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002 and ADO-003: edit Clause rules and Form field maps together. */
import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { RuleValueInput, defaultRuleValue } from "./rule-value-input";
import {
  autoDocContractAttributes,
  autoDocClauseRule,
  type AutoDocField,
  type AutoDocOptions,
  type AutoDocClauseRule,
} from "../../lib/auto-docs";

export function FieldMap({
  field,
  options,
  onChange,
}: {
  field: AutoDocField;
  options: AutoDocOptions;
  onChange: (map: Pick<AutoDocField, "catalogFieldId" | "contractAttribute">) => void;
}) {
  const intl = useIntl();
  return (
    <label className="block space-y-1">
      <span>
        <FormattedMessage id="autoDocs.mapTo" defaultMessage="Map to" />
      </span>
      <select
        className={CONTROL_CLASS}
        value={
          field.catalogFieldId
            ? `catalog:${field.catalogFieldId}`
            : field.contractAttribute
              ? `attribute:${field.contractAttribute}`
              : ""
        }
        onChange={(event) => {
          const value = event.target.value;
          onChange({
            catalogFieldId: value.startsWith("catalog:") ? value.slice(8) : null,
            contractAttribute: value.startsWith("attribute:")
              ? (value.slice(10) as AutoDocField["contractAttribute"])
              : null,
          });
        }}
      >
        <option value="">
          {intl.formatMessage({ id: "autoDocs.noMap", defaultMessage: "No map" })}
        </option>
        <optgroup
          label={intl.formatMessage({
            id: "autoDocs.contractAttributes",
            defaultMessage: "Contract attributes",
          })}
        >
          {autoDocContractAttributes.options.map((attribute) => (
            <option key={attribute} value={`attribute:${attribute}`}>
              {intl.formatMessage(
                {
                  id: "autoDocs.attributeName",
                  defaultMessage:
                    "{attribute, select, title {Title} primary_counterparty_name {Primary Counterparty name} entity_id {Our Entity} owning_department_id {Owning department} region {Region} value {Value} effective_date {Effective date} expiry_date {Expiry date} other {Term type}}",
                },
                { attribute },
              )}
            </option>
          ))}
        </optgroup>
        <optgroup
          label={intl.formatMessage({
            id: "autoDocs.catalogFields",
            defaultMessage: "Catalog Fields",
          })}
        >
          {field.catalogFieldId &&
            !options.catalogFields.some((row) => row.id === field.catalogFieldId) && (
              <option value={`catalog:${field.catalogFieldId}`}>
                {intl.formatMessage({
                  id: "autoDocs.unavailableMap",
                  defaultMessage: "Unavailable catalog Field",
                })}
              </option>
            )}
          {options.catalogFields.map((row) => (
            <option key={row.id} value={`catalog:${row.id}`}>
              {row.displayName}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

export function ClausesEditor({
  blocks,
  fields,
  rules,
  disabled,
  onChange,
}: {
  blocks: string[];
  fields: AutoDocField[];
  rules: AutoDocClauseRule[];
  disabled: boolean;
  onChange: (rules: AutoDocClauseRule[]) => void;
}) {
  const intl = useIntl();
  const names = [...new Set([...blocks, ...rules.map((rule) => rule.blockName)])];
  const change = (rule: AutoDocClauseRule) =>
    onChange(
      rules.some((row) => row.blockName === rule.blockName)
        ? rules.map((row) => (row.blockName === rule.blockName ? rule : row))
        : [...rules, rule],
    );
  const operatorName = (operator: string) =>
    intl.formatMessage(
      {
        id: "autoDocs.ruleOperator",
        defaultMessage:
          "{operator, select, equals {Equals} is_one_of {Is one of} is_set {Is set} other {Is not}}",
      },
      { operator },
    );
  return (
    <section aria-labelledby="auto-doc-clauses-title" className="space-y-4">
      <h3 id="auto-doc-clauses-title" className="font-semibold">
        <FormattedMessage id="autoDocs.clauses" defaultMessage="Clauses" />
      </h3>
      {!names.length && (
        <p className="text-sm text-muted">
          <FormattedMessage id="autoDocs.noBlocks" defaultMessage="This template has no Blocks." />
        </p>
      )}
      {names.map((blockName) => {
        const rule = rules.find((row) => row.blockName === blockName);
        const field = fields.find((row) => row.slug === rule?.fieldSlug);
        return (
          <fieldset
            key={blockName}
            disabled={disabled}
            className="space-y-3 rounded-card border border-border-default p-4"
          >
            <legend className="px-1 font-medium">{blockName}</legend>
            {!blocks.includes(blockName) && (
              <p className="text-sm text-status-danger-fg">
                <FormattedMessage
                  id="autoDocs.missingBlock"
                  defaultMessage="This Block is missing from the current template. Remove its rule or choose an earlier file version when publishing."
                />
              </p>
            )}
            <label className="block space-y-1">
              <span>
                <FormattedMessage id="autoDocs.includeBlock" defaultMessage="Include this Block" />
              </span>
              <select
                className={CONTROL_CLASS}
                value={rule ? "conditional" : "always"}
                onChange={(event) => {
                  if (event.target.value === "always")
                    onChange(rules.filter((row) => row.blockName !== blockName));
                  else
                    change({
                      blockName,
                      fieldSlug: fields[0]?.slug ?? "",
                      operator: "equals",
                      value: defaultRuleValue("equals", fields[0]),
                    });
                }}
              >
                <option value="always">
                  {intl.formatMessage({
                    id: "autoDocs.alwaysInclude",
                    defaultMessage: "Always include",
                  })}
                </option>
                <option
                  value="conditional"
                  disabled={!fields.length || !blocks.includes(blockName)}
                >
                  {intl.formatMessage({
                    id: "autoDocs.whenRuleMatches",
                    defaultMessage: "When a Clause rule matches",
                  })}
                </option>
              </select>
            </label>
            {rule && (
              <div className="grid gap-3 @lg/page:grid-cols-3">
                <label className="block space-y-1">
                  <span>
                    <FormattedMessage id="autoDocs.ruleField" defaultMessage="Form field" />
                  </span>
                  <select
                    className={CONTROL_CLASS}
                    value={rule.fieldSlug}
                    onChange={(event) => {
                      const nextField = fields.find((row) => row.slug === event.target.value);
                      change({
                        ...rule,
                        fieldSlug: event.target.value,
                        value: defaultRuleValue(rule.operator, nextField),
                      });
                    }}
                  >
                    {!field && (
                      <option value={rule.fieldSlug}>
                        {intl.formatMessage(
                          { id: "autoDocs.missingRuleField", defaultMessage: "{slug} (missing)" },
                          { slug: rule.fieldSlug },
                        )}
                      </option>
                    )}
                    {fields.map((row) => (
                      <option key={row.slug} value={row.slug}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span>
                    <FormattedMessage id="autoDocs.operator" defaultMessage="Operator" />
                  </span>
                  <select
                    className={CONTROL_CLASS}
                    value={rule.operator}
                    onChange={(event) => {
                      const parsed = autoDocClauseRule.shape.operator.safeParse(event.target.value);
                      if (!parsed.success) return;
                      const operator = parsed.data;
                      change({ ...rule, operator, value: defaultRuleValue(operator, field) });
                    }}
                  >
                    {(["equals", "is_one_of", "is_set", "is_not"] as const).map((operator) => (
                      <option key={operator} value={operator}>
                        {operatorName(operator)}
                      </option>
                    ))}
                  </select>
                </label>
                <RuleValueInput
                  field={field}
                  fieldSlug={rule.fieldSlug}
                  operator={rule.operator}
                  value={rule.value}
                  onChange={(value) => change({ ...rule, value })}
                />
              </div>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}
