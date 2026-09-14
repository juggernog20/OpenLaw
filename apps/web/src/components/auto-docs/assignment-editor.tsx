// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-006: edit ordered Assignment rules and the default Legal Owner. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { autoDocClauseRule } from "../../lib/auto-docs";
import type { AutoDocAnswer, AutoDocOptions } from "../../lib/auto-docs";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { RuleValueInput, defaultRuleValue } from "./rule-value-input";

type Rule = Omit<AutoDocAnswer["assignmentRules"][number], "id" | "displayOrder"> & {
  id?: string;
  key: string;
};
export function AssignmentEditor({
  record,
  options,
  onSaved,
}: {
  record: AutoDocAnswer;
  options: AutoDocOptions;
  onSaved: (record: AutoDocAnswer) => void;
}) {
  const intl = useIntl();
  const [rules, setRules] = useState<Rule[]>(() =>
    record.assignmentRules.map((rule) => ({ ...rule, key: rule.id })),
  );
  const [defaultOwner, setDefaultOwner] = useState(record.autoDoc.defaultLegalOwnerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [sourceRecord, setSourceRecord] = useState(record);
  if (record !== sourceRecord) {
    setSourceRecord(record);
    setRules(record.assignmentRules.map((rule) => ({ ...rule, key: rule.id })));
    setDefaultOwner(record.autoDoc.defaultLegalOwnerId ?? "");
  }
  const fields = record.formVersion?.definition.fields ?? [];
  const disabled = busy || record.autoDoc.state === "archived";
  const change = (index: number, patch: Partial<Rule>) =>
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const move = (index: number, delta: number) =>
    setRules((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
      return next;
    });
  function ownerOptions(value: string) {
    return (
      <>
        {value && !options.legalOwners.some((owner) => owner.id === value) && (
          <option value={value}>
            {intl.formatMessage({
              id: "autoDocs.unavailableLegalOwner",
              defaultMessage: "Unavailable Legal Owner",
            })}
          </option>
        )}
        {options.legalOwners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.displayName}
          </option>
        ))}
      </>
    );
  }
  async function save() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const { data, error } = await api.PUT("/api/v1/auto-docs/{id}/assignment-rules", {
        params: { path: { id: record.autoDoc.id } },
        body: {
          rules: rules.map((rule) => ({
            id: rule.id,
            fieldSlug: rule.fieldSlug,
            operator: rule.operator,
            value: rule.value,
            legalOwnerId: rule.legalOwnerId,
          })),
          defaultLegalOwnerId: defaultOwner || null,
        },
      });
      if (!data)
        throw new Error(
          error?.detail ??
            intl.formatMessage({
              id: "autoDocs.assignmentRefused",
              defaultMessage: "Assignment settings could not be saved.",
            }),
        );
      setRules(data.assignmentRules.map((rule) => ({ ...rule, key: rule.id })));
      onSaved(data);
      setNotice(
        intl.formatMessage({
          id: "autoDocs.assignmentSaved",
          defaultMessage: "Assignment settings saved.",
        }),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : intl.formatMessage({
              id: "autoDocs.assignmentRefused",
              defaultMessage: "Assignment settings could not be saved.",
            }),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-labelledby="auto-doc-assignment-title"
      className="space-y-4 rounded-card border border-border-default bg-raised p-6"
    >
      <h2 id="auto-doc-assignment-title" className="text-lg font-semibold">
        <FormattedMessage id="autoDocs.assignmentRules" defaultMessage="Assignment rules" />
      </h2>
      <p className="text-sm text-muted">
        <FormattedMessage
          id="autoDocs.assignmentHelp"
          defaultMessage="For generated Contracts, the first matching rule chooses the Legal Owner. If no rule matches, the default applies. Without either, the Contract waits in the Inbox to be claimed."
        />
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {rules.map((rule, index) => {
          const field = fields.find((field) => field.slug === rule.fieldSlug);
          return (
            <fieldset
              key={rule.key}
              disabled={disabled}
              className="space-y-3 rounded-card border border-border-default p-4"
            >
              <legend className="px-1 font-medium">
                <FormattedMessage
                  id="autoDocs.assignmentRuleNumber"
                  defaultMessage="Assignment rule {number}"
                  values={{ number: index + 1 }}
                />
              </legend>
              <div className="grid gap-3 @sm:grid-cols-2">
                <label className="block space-y-1">
                  <span>
                    <FormattedMessage id="autoDocs.ruleField" defaultMessage="Form field" />
                  </span>
                  <select
                    className={CONTROL_CLASS}
                    value={rule.fieldSlug}
                    onChange={(event) =>
                      change(index, {
                        fieldSlug: event.target.value,
                        value: defaultRuleValue(
                          rule.operator,
                          fields.find((field) => field.slug === event.target.value),
                        ),
                      })
                    }
                  >
                    {!field && (
                      <option value={rule.fieldSlug}>
                        {intl.formatMessage(
                          { id: "autoDocs.missingRuleField", defaultMessage: "{slug} (missing)" },
                          { slug: rule.fieldSlug },
                        )}
                      </option>
                    )}
                    {fields.map((field) => (
                      <option key={field.slug} value={field.slug}>
                        {field.label}
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
                      change(index, { operator, value: defaultRuleValue(operator, field) });
                    }}
                  >
                    {(["equals", "is_one_of", "is_set", "is_not"] as const).map((operator) => (
                      <option key={operator} value={operator}>
                        {intl.formatMessage(
                          {
                            id: "autoDocs.ruleOperator",
                            defaultMessage:
                              "{operator, select, equals {Equals} is_one_of {Is one of} is_set {Is set} other {Is not}}",
                          },
                          { operator },
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <RuleValueInput
                  field={field}
                  fieldSlug={rule.fieldSlug}
                  operator={rule.operator}
                  value={rule.value}
                  onChange={(value) => change(index, { value })}
                />
                <label className="block space-y-1">
                  <span>
                    <FormattedMessage id="autoDocs.legalOwner" defaultMessage="Legal Owner" />
                  </span>
                  <select
                    className={CONTROL_CLASS}
                    required
                    value={rule.legalOwnerId}
                    onChange={(event) => change(index, { legalOwnerId: event.target.value })}
                  >
                    {ownerOptions(rule.legalOwnerId)}
                  </select>
                </label>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <FormattedMessage id="autoDocs.assignmentMoveUp" defaultMessage="Move up" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled || index === rules.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <FormattedMessage id="autoDocs.assignmentMoveDown" defaultMessage="Move down" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
                >
                  <FormattedMessage id="autoDocs.assignmentRemove" defaultMessage="Remove rule" />
                </Button>
              </div>
            </fieldset>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          disabled={
            disabled || !fields.length || !options.legalOwners.length || rules.length >= 100
          }
          onClick={() =>
            setRules((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                fieldSlug: fields[0]!.slug,
                operator: "equals",
                value: defaultRuleValue("equals", fields[0]),
                legalOwnerId: options.legalOwners[0]!.id,
              },
            ])
          }
        >
          <FormattedMessage id="autoDocs.assignmentAdd" defaultMessage="Add rule" />
        </Button>
        <label className="block max-w-sm space-y-1">
          <span>
            <FormattedMessage
              id="autoDocs.defaultLegalOwner"
              defaultMessage="Default Legal Owner"
            />
          </span>
          <select
            className={CONTROL_CLASS}
            disabled={disabled}
            value={defaultOwner}
            onChange={(event) => setDefaultOwner(event.target.value)}
          >
            <option value="">
              {intl.formatMessage({
                id: "autoDocs.noDefaultOwner",
                defaultMessage: "None — leave unassigned",
              })}
            </option>
            {ownerOptions(defaultOwner)}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        )}
        <Button type="submit" disabled={disabled}>
          <FormattedMessage id="autoDocs.saveAssignment" defaultMessage="Save assignment" />
        </Button>
      </form>
    </section>
  );
}
