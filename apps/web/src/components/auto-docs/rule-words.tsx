// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A rule as a sentence (DES-087): "Jurisdiction equals United States".
 * The field's label, never its slug; the option's text, never its index.
 */
import { useIntl } from "react-intl";
import type { AutoDocClauseRule, AutoDocField } from "../../lib/auto-docs";

export type Condition = Pick<AutoDocClauseRule, "fieldSlug" | "operator" | "value">;

export function useRuleWords() {
  const intl = useIntl();
  const yes = intl.formatMessage({ id: "common.yes", defaultMessage: "Yes" });
  const no = intl.formatMessage({ id: "common.no", defaultMessage: "No" });
  function scalar(value: string | number | boolean): string {
    if (typeof value === "boolean") return value ? yes : no;
    return String(value);
  }
  function words(rule: Condition, fields: readonly AutoDocField[]): string {
    const field = fields.find((row) => row.slug === rule.fieldSlug);
    const label =
      field?.label ??
      intl.formatMessage({ id: "autoDocs.missingRuleField", defaultMessage: "Missing field" });
    const value = Array.isArray(rule.value)
      ? intl.formatList(rule.value.map(scalar), { type: "conjunction", style: "narrow" })
      : rule.value === null
        ? ""
        : scalar(rule.value);
    return intl.formatMessage(
      {
        id: "autoDocs.ruleWords",
        defaultMessage:
          "{operator, select, equals {{label} equals {value}} is_one_of {{label} is one of {value}} is_set {{label} is set} other {{label} is not {value}}}",
      },
      { operator: rule.operator, label, value },
    );
  }
  return words;
}

export function useFieldTypeName() {
  const intl = useIntl();
  return (type: AutoDocField["fieldType"]) =>
    intl.formatMessage(
      {
        id: "autoDocs.fieldTypeName",
        defaultMessage:
          "{type, select, text {Text} long_text {Long text} number {Number} currency {Currency} date {Date} boolean {Boolean} single_select {Single select} multi_select {Multi select} other {Entity}}",
      },
      { type },
    );
}
