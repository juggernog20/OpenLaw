// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The form half of the builder (DES-087 clause 3): the Fields and
 * Clauses tables, and under them the card for the selected row. Every
 * commit here writes one form version (ADO-004); there is no Save form
 * and no dirty state.
 */
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import {
  autoDocClauseRule,
  autoDocFieldTypes,
  type AutoDocAnswer,
  type AutoDocClauseRule,
  type AutoDocField,
  type AutoDocOptions,
} from "../../lib/auto-docs";
import { useFieldCommit, type CommitOutcome, type FieldStatus } from "../../lib/field-commit";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { CurrencySelect } from "../currency-select";
import { ListEditor } from "../list-editor";
import { SettingsCard } from "../settings-card";
import { StatusNote } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { defaultRuleValue, RuleValueInput } from "./rule-value-input";
import { useFieldTypeName, useRuleWords } from "./rule-words";

export type BuilderSelection =
  { kind: "field"; slug: string } | { kind: "block"; name: string } | null;

type Definition = NonNullable<AutoDocAnswer["formVersion"]>["definition"];
const FIELD_TYPES = autoDocFieldTypes.options;
const OPERATORS = ["equals", "is_one_of", "is_set", "is_not"] as const;

/** What the seam takes: the field without its derived order and provenance. */
function fieldInput(field: AutoDocField) {
  return {
    slug: field.slug,
    label: field.label,
    help: field.help || null,
    fieldType: field.fieldType,
    required: field.required,
    options: field.options,
    catalogFieldId: field.catalogFieldId,
    contractAttribute: field.contractAttribute,
    valueCurrency: field.valueCurrency ?? null,
    valueCadence: field.valueCadence ?? null,
  };
}
const isSelect = (type: AutoDocField["fieldType"]) =>
  type === "single_select" || type === "multi_select";

export function FormBuilder({
  record,
  options,
  selected,
  onSelect,
  onSaved,
  onCompare,
}: {
  record: AutoDocAnswer;
  options: AutoDocOptions;
  selected: BuilderSelection;
  onSelect: (selection: BuilderSelection) => void;
  onSaved: (record: AutoDocAnswer) => void;
  onCompare: () => void;
}) {
  const intl = useIntl();
  const words = useRuleWords();
  const typeName = useFieldTypeName();
  const commits = useFieldCommit<string>();
  const [removing, setRemoving] = useState<AutoDocField | null>(null);
  const archived = record.autoDoc.state === "archived";
  const fields = record.formVersion?.definition.fields ?? [];
  const rules = record.formVersion?.definition.clauseRules ?? [];
  const blocks = record.detection.blocks;
  const orphaned = fields.filter((field) => record.orphanedFields.includes(field.slug));
  const fileNumber = record.template?.versions[0]?.versionNumber ?? 0;

  // Every commit writes the whole definition, so two commits in flight
  // would race and the second would carry the first's stale fields. They
  // queue instead, and each derives its definition from the newest
  // saved record when its turn comes, not from the render that asked.
  const latest = useRef(record);
  useEffect(() => {
    latest.current = record;
  }, [record]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function commitDefinition(
    key: string,
    produce: (current: Definition) => Definition,
  ): Promise<CommitOutcome> {
    const turn = queue.current.then(() => {
      const current = latest.current.formVersion?.definition ?? { fields: [], clauseRules: [] };
      const next = produce(current);
      return commits.commit(
        key,
        () =>
          api.POST("/api/v1/auto-docs/{id}/form-versions", {
            params: { path: { id: record.autoDoc.id } },
            body: { fields: next.fields.map(fieldInput), clauseRules: next.clauseRules },
          }),
        (saved) => {
          latest.current = saved;
          onSaved(saved);
        },
      );
    });
    queue.current = turn.catch(() => undefined);
    return turn;
  }
  const replaceField =
    (slug: string, patch: Partial<AutoDocField>) =>
    (current: Definition): Definition => ({
      fields: current.fields.map((field) => (field.slug === slug ? { ...field, ...patch } : field)),
      clauseRules:
        patch.slug && patch.slug !== slug
          ? current.clauseRules.map((rule) =>
              rule.fieldSlug === slug ? { ...rule, fieldSlug: patch.slug! } : rule,
            )
          : current.clauseRules,
    });

  async function addField() {
    let number = 1;
    while (fields.some((field) => field.slug === `field_${number}`)) number++;
    const slug = `field_${number}`;
    const outcome = await commitDefinition("add", (current) => ({
      clauseRules: current.clauseRules,
      fields: [
        ...current.fields,
        {
          slug,
          label: intl.formatMessage({ id: "autoDocs.newField", defaultMessage: "New field" }),
          help: null,
          fieldType: "text",
          options: null,
          required: false,
          displayOrder: fields.length,
          placeholder: false,
          catalogFieldId: null,
          contractAttribute: null,
        },
      ],
    }));
    if (outcome.ok) onSelect({ kind: "field", slug });
  }
  async function removeField(field: AutoDocField) {
    setRemoving(null);
    const outcome = await commitDefinition(`row:${field.slug}`, (current) => ({
      fields: current.fields.filter((row) => row.slug !== field.slug),
      clauseRules: current.clauseRules.filter((rule) => rule.fieldSlug !== field.slug),
    }));
    if (outcome.ok && selected?.kind === "field" && selected.slug === field.slug) onSelect(null);
  }
  function requestRemove(field: AutoDocField) {
    // Removal of a field whose Placeholder is still in the file runs a
    // guard: Publish will refuse until the file changes.
    if (record.detection.placeholders.includes(field.slug)) setRemoving(field);
    else void removeField(field);
  }

  const rowKey = (slug: string) => `row:${slug}`;
  const rowStatus: Record<string, FieldStatus> = {};
  const rowError: Record<string, string | undefined> = {};
  for (const field of fields) {
    rowStatus[field.slug] = commits.status[rowKey(field.slug)] ?? "idle";
    rowError[field.slug] = commits.error[rowKey(field.slug)];
  }

  const ruleNames = [...new Set([...blocks, ...rules.map((rule) => rule.blockName)])];
  const selectedField =
    selected?.kind === "field" ? fields.find((field) => field.slug === selected.slug) : undefined;
  // A Block the file lacks and no rule names has no row, so it has no card.
  const selectedBlock =
    selected?.kind === "block" && ruleNames.includes(selected.name) ? selected.name : undefined;

  const selectButton = (label: string, onClick: () => void) => (
    <Button variant="ghost" size="sm" className="px-1.5" aria-label={label} onClick={onClick}>
      <Pencil size={16} aria-hidden="true" className="text-muted" />
    </Button>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 @lg/page:w-120 @lg/page:shrink-0">
      <ListEditor
        region
        rows={fields.map((field) => ({
          ...field,
          id: field.slug,
          displayName: field.label,
          archivedAt: null,
        }))}
        title={<FormattedMessage id="autoDocs.fields" defaultMessage="Fields" />}
        count={
          <span className="flex items-center gap-2">
            <FormattedMessage
              id="autoDocs.fieldCount"
              defaultMessage="{count, plural, one {# field} other {# fields}}"
              values={{ count: fields.length }}
            />
            {orphaned.length > 0 && (
              <span className="rounded-pill bg-status-danger-bg px-2 py-0.5 text-xs font-medium text-status-danger-fg">
                <FormattedMessage
                  id="autoDocs.orphanCount"
                  defaultMessage="{count, plural, one {# orphaned} other {# orphaned}}"
                  values={{ count: orphaned.length }}
                />
              </span>
            )}
            {record.formVersions.length > 1 && (
              <Button variant="secondary" size="sm" onClick={onCompare}>
                <FormattedMessage id="autoDocs.compareVersions" defaultMessage="Compare versions" />
              </Button>
            )}
          </span>
        }
        addLabel={<FormattedMessage id="autoDocs.addField" defaultMessage="Add field" />}
        onAdd={archived ? undefined : () => void addField()}
        busy={archived}
        help={
          <FormattedMessage
            id="autoDocs.fieldsHelp"
            defaultMessage="Drag to reorder. Each change saves a new form version."
          />
        }
        rowStatus={rowStatus}
        rowError={rowError}
        renameLabel={(row) =>
          intl.formatMessage(
            { id: "autoDocs.renameField", defaultMessage: "Rename {label}" },
            { label: row.label },
          )
        }
        onRename={
          archived
            ? undefined
            : (row, label) =>
                void commitDefinition(rowKey(row.slug), replaceField(row.slug, { label }))
        }
        rowClassName={(row) =>
          selected?.kind === "field" && selected.slug === row.slug ? "bg-control" : undefined
        }
        rowCaption={(row) => (
          <>
            {typeName(row.fieldType)}
            {row.contractAttribute || row.catalogFieldId ? (
              <> · {mapName(row, options, intl)}</>
            ) : null}
          </>
        )}
        rowDetails={(row) =>
          record.orphanedFields.includes(row.slug) ? (
            <span className="text-xs whitespace-nowrap text-status-danger-fg">
              <FormattedMessage
                id="autoDocs.orphanRow"
                defaultMessage="No Placeholder in file version {number}"
                values={{ number: fileNumber }}
              />
            </span>
          ) : selected?.kind === "field" && selected.slug === row.slug ? (
            <span className="sr-only">
              <FormattedMessage id="autoDocs.selectedRow" defaultMessage="Selected" />
            </span>
          ) : null
        }
        rowActions={(row) =>
          selectButton(
            intl.formatMessage(
              { id: "autoDocs.editField", defaultMessage: "Edit {label}" },
              { label: row.label },
            ),
            () => onSelect({ kind: "field", slug: row.slug }),
          )
        }
        removeLabel={(row) =>
          intl.formatMessage(
            { id: "autoDocs.removeFieldNamed", defaultMessage: "Remove {label}" },
            { label: row.label },
          )
        }
        onRemove={archived ? undefined : (row) => requestRemove(row)}
        reorder={
          archived
            ? undefined
            : {
                status: commits.status.order ?? "idle",
                detail: commits.error.order,
                gripLabel: (row, position, total) =>
                  intl.formatMessage(
                    {
                      id: "autoDocs.gripLabel",
                      defaultMessage: "Reorder {label}, {position} of {total}",
                    },
                    { label: row.displayName, position, total },
                  ),
                onMove: (from, to) => {
                  void commitDefinition("order", (current) => {
                    const next = [...current.fields];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved!);
                    return { fields: next, clauseRules: current.clauseRules };
                  });
                },
              }
        }
      />
      <ListEditor
        region
        rows={ruleNames.map((name) => ({ id: name, displayName: name, archivedAt: null }))}
        title={<FormattedMessage id="autoDocs.clauses" defaultMessage="Clauses" />}
        count={
          <span className="flex items-center gap-2">
            <FormattedMessage
              id="autoDocs.blockCount"
              defaultMessage="{count, plural, one {# Block} other {# Blocks}}"
              values={{ count: ruleNames.length }}
            />
            {ruleNames.some((name) => !blocks.includes(name)) && (
              <span className="rounded-pill bg-status-danger-bg px-2 py-0.5 text-xs font-medium text-status-danger-fg">
                <FormattedMessage
                  id="autoDocs.missingBlockCount"
                  defaultMessage="{count, plural, one {# missing} other {# missing}}"
                  values={{ count: ruleNames.filter((name) => !blocks.includes(name)).length }}
                />
              </span>
            )}
          </span>
        }
        help={
          <FormattedMessage
            id="autoDocs.clausesHelp"
            defaultMessage="A Block with no rule is always included."
          />
        }
        rowStatus={Object.fromEntries(
          ruleNames.map((name) => [name, commits.status[`block:${name}`] ?? "idle"]),
        )}
        rowError={Object.fromEntries(
          ruleNames.map((name) => [name, commits.error[`block:${name}`]]),
        )}
        rowClassName={(row) =>
          selected?.kind === "block" && selected.name === row.id ? "bg-control" : undefined
        }
        rowCaption={(row) => {
          const rule = rules.find((candidate) => candidate.blockName === row.id);
          return rule
            ? intl.formatMessage(
                { id: "autoDocs.includedWhen", defaultMessage: "Included when {rule}" },
                { rule: words(rule, fields) },
              )
            : intl.formatMessage({
                id: "autoDocs.alwaysIncluded",
                defaultMessage: "Always included",
              });
        }}
        rowDetails={(row) =>
          blocks.includes(row.id) ? null : (
            <span className="text-xs whitespace-nowrap text-status-danger-fg">
              <FormattedMessage
                id="autoDocs.missingBlockRow"
                defaultMessage="Not in file version {number}"
                values={{ number: fileNumber }}
              />
            </span>
          )
        }
        rowActions={(row) =>
          selectButton(
            intl.formatMessage(
              { id: "autoDocs.editRule", defaultMessage: "Edit the rule for {name}" },
              { name: row.id },
            ),
            () => onSelect({ kind: "block", name: row.id }),
          )
        }
      />
      {ruleNames.length === 0 && (
        <p className="-mt-2 text-sm text-muted">
          <FormattedMessage id="autoDocs.noBlocks" defaultMessage="This file has no Blocks." />
        </p>
      )}
      {selectedField && (
        <FieldCard
          key={selectedField.slug}
          field={selectedField}
          fields={fields}
          rules={rules}
          assignmentUses={
            record.assignmentRules.filter((rule) => rule.fieldSlug === selectedField.slug).length
          }
          options={options}
          disabled={archived}
          commits={commits}
          onCommit={(key, patch) =>
            commitDefinition(key, replaceField(selectedField.slug, patch)).then((outcome) => {
              if (outcome.ok && patch.slug && patch.slug !== selectedField.slug)
                onSelect({ kind: "field", slug: patch.slug });
              return outcome;
            })
          }
          onRemove={() => requestRemove(selectedField)}
        />
      )}
      {selectedBlock !== undefined && (
        <RuleCard
          key={selectedBlock}
          blockName={selectedBlock}
          present={blocks.includes(selectedBlock)}
          fields={fields}
          rule={rules.find((rule) => rule.blockName === selectedBlock)}
          disabled={archived}
          commits={commits}
          onCommit={(next) =>
            commitDefinition(`block:${selectedBlock}`, (current) => ({
              fields: current.fields,
              clauseRules: next
                ? current.clauseRules.some((rule) => rule.blockName === selectedBlock)
                  ? current.clauseRules.map((rule) =>
                      rule.blockName === selectedBlock ? next : rule,
                    )
                  : [...current.clauseRules, next]
                : current.clauseRules.filter((rule) => rule.blockName !== selectedBlock),
            }))
          }
        />
      )}
      {removing && (
        <Dialog open onOpenChange={(open) => !open && setRemoving(null)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>
              <FormattedMessage
                id="autoDocs.removeFieldTitle"
                defaultMessage="Remove {label}?"
                values={{ label: removing.label }}
              />
            </DialogTitle>
            <p className="text-sm">
              <FormattedMessage
                id="autoDocs.removeFieldGuard"
                defaultMessage="The file still holds the Placeholder {placeholder}. Publish will refuse until the file changes or the field is back."
                values={{ placeholder: `{{${removing.slug}}}` }}
              />
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </Button>
              <Button variant="danger" onClick={() => void removeField(removing)}>
                <FormattedMessage id="common.remove" defaultMessage="Remove" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function mapName(
  field: AutoDocField,
  options: AutoDocOptions,
  intl: ReturnType<typeof useIntl>,
): string {
  if (field.contractAttribute)
    return intl.formatMessage(
      {
        id: "autoDocs.attributeName",
        defaultMessage:
          "{attribute, select, title {Title} counterparties {Primary Counterparty name} entity {Our Entity} owning_department {Owning department} region {Region} value {Value} effective_date {Effective date} expiry_date {Expiry date} other {Term type}}",
      },
      { attribute: field.contractAttribute },
    );
  if (field.catalogFieldId)
    return (
      options.catalogFields.find((row) => row.id === field.catalogFieldId)?.displayName ??
      intl.formatMessage({
        id: "autoDocs.unavailableCatalogField",
        defaultMessage: "Unavailable catalog Field",
      })
    );
  return "";
}

type Commits = ReturnType<typeof useFieldCommit<string>>;

function Control({
  label,
  htmlFor,
  status,
  error,
  caption,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  status: FieldStatus;
  error?: string;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        <StatusNote status={status} detail={error} />
      </div>
      {children}
      {caption && <span className="text-xs text-muted">{caption}</span>}
    </div>
  );
}

function FieldCard({
  field,
  fields,
  rules,
  assignmentUses,
  options,
  disabled,
  commits,
  onCommit,
  onRemove,
}: {
  field: AutoDocField;
  fields: AutoDocField[];
  rules: AutoDocClauseRule[];
  assignmentUses: number;
  options: AutoDocOptions;
  disabled: boolean;
  commits: Commits;
  onCommit: (key: string, patch: Partial<AutoDocField>) => Promise<CommitOutcome>;
  onRemove: () => void;
}) {
  const intl = useIntl();
  const typeName = useFieldTypeName();
  const [label, setLabel] = useState(field.label);
  const [slug, setSlug] = useState(field.slug);
  const [help, setHelp] = useState(field.help ?? "");
  const [optionText, setOptionText] = useState(field.options?.join("\n") ?? "");
  const id = `auto-doc-field-${field.slug}`;
  const status = (key: string) => commits.status[key] ?? "idle";
  const text = (
    key: string,
    draft: string,
    saved: string,
    reset: (value: string) => void,
    send: (value: string) => Partial<AutoDocField>,
    required = false,
  ) => ({
    onBlur: () =>
      commits.commitText(key, {
        draft,
        saved,
        required,
        reset,
        send: (value) => onCommit(key, send(value)),
      }),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        (event.target as HTMLElement).blur();
      }
      if (event.key === "Escape") commits.revertText(key, { draft, saved, reset, send: () => {} });
    },
  });
  const clauseUses = rules.filter((rule) => rule.fieldSlug === field.slug).length;
  const slugTaken = (candidate: string) =>
    candidate !== field.slug && fields.some((row) => row.slug === candidate);
  return (
    <SettingsCard region title={field.label}>
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <Control
          label={<FormattedMessage id="autoDocs.fieldLabel" defaultMessage="Label" />}
          htmlFor={`${id}-label`}
          status={status("label")}
          error={commits.error.label}
        >
          <Input
            id={`${id}-label`}
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            {...text("label", label, field.label, setLabel, (value) => ({ label: value }), true)}
          />
        </Control>
        <Control
          label={
            <FormattedMessage
              id="autoDocs.templatePlaceholder"
              defaultMessage="Template placeholder"
            />
          }
          htmlFor={`${id}-slug`}
          status={status("slug")}
          error={commits.error.slug}
          caption={
            <FormattedMessage
              id="autoDocs.slugCaption"
              defaultMessage="Must match the Placeholder in the file."
            />
          }
        >
          <Input
            id={`${id}-slug`}
            value={slug}
            maxLength={120}
            pattern="[a-z][a-z0-9_]*"
            onChange={(event) => setSlug(event.target.value)}
            {...text("slug", slug, field.slug, setSlug, (value) => ({ slug: value }), true)}
            onBlur={() => {
              if (!/^[a-z][a-z0-9_]*$/.test(slug.trim()) || slugTaken(slug.trim())) {
                commits.note(
                  "slug",
                  "error",
                  intl.formatMessage({
                    id: "autoDocs.slugRefused",
                    defaultMessage:
                      "Use lowercase letters, digits, and underscores, unique on this form.",
                  }),
                );
                setSlug(field.slug);
                return;
              }
              commits.commitText("slug", {
                draft: slug,
                saved: field.slug,
                required: true,
                reset: setSlug,
                send: (value) => onCommit("slug", { slug: value }),
              });
            }}
          />
        </Control>
        <Control
          label={<FormattedMessage id="autoDocs.fieldType" defaultMessage="Type" />}
          htmlFor={`${id}-type`}
          status={status("type")}
          error={commits.error.type}
        >
          <select
            id={`${id}-type`}
            className={CONTROL_CLASS}
            value={field.fieldType}
            onChange={(event) => {
              const fieldType = event.target.value as AutoDocField["fieldType"];
              void onCommit("type", {
                fieldType,
                options: isSelect(fieldType)
                  ? field.options?.length
                    ? field.options
                    : ["Option 1"]
                  : null,
              });
            }}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeName(type)}
              </option>
            ))}
          </select>
        </Control>
        {isSelect(field.fieldType) && (
          <Control
            label={<FormattedMessage id="autoDocs.fieldOptions" defaultMessage="Options" />}
            htmlFor={`${id}-options`}
            status={status("options")}
            error={commits.error.options}
            caption={
              <FormattedMessage id="autoDocs.optionsCaption" defaultMessage="One per line." />
            }
          >
            <AutoResizeTextarea
              id={`${id}-options`}
              className={TEXTAREA_CLASS}
              value={optionText}
              onChange={(event) => setOptionText(event.target.value)}
              onBlur={() => {
                const next = optionText
                  .split("\n")
                  .map((option) => option.trim())
                  .filter((option) => option.length > 0);
                if (next.length === 0 || new Set(next).size !== next.length) {
                  commits.note(
                    "options",
                    "error",
                    intl.formatMessage({
                      id: "autoDocs.optionsRefused",
                      defaultMessage: "Give the field distinct, non-empty options.",
                    }),
                  );
                  return;
                }
                if (next.join("\n") === (field.options ?? []).join("\n")) return;
                void onCommit("options", { options: next });
              }}
            />
          </Control>
        )}
        <Control
          label={<FormattedMessage id="autoDocs.fieldHelp" defaultMessage="Help text" />}
          htmlFor={`${id}-help`}
          status={status("help")}
          error={commits.error.help}
        >
          <Input
            id={`${id}-help`}
            value={help}
            maxLength={4000}
            onChange={(event) => setHelp(event.target.value)}
            {...text("help", help, field.help ?? "", setHelp, (value) => ({ help: value || null }))}
          />
        </Control>
        <Control
          label={<FormattedMessage id="autoDocs.mapTo" defaultMessage="Map to" />}
          htmlFor={`${id}-map`}
          status={status("map")}
          error={commits.error.map}
        >
          <select
            id={`${id}-map`}
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
              void onCommit("map", {
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
              {(
                [
                  "title",
                  "counterparties",
                  "entity",
                  "owning_department",
                  "region",
                  "value",
                  "effective_date",
                  "expiry_date",
                  "term_type",
                ] as const
              ).map((attribute) => (
                <option key={attribute} value={`attribute:${attribute}`}>
                  {mapName(
                    { ...field, contractAttribute: attribute, catalogFieldId: null },
                    options,
                    intl,
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
                      id: "autoDocs.unavailableCatalogField",
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
        </Control>
        {field.contractAttribute === "value" && (
          <div className="grid gap-4 @sm:grid-cols-2">
            <Control
              label={<FormattedMessage id="autoDocs.valueCurrency" defaultMessage="Currency" />}
              htmlFor={`${id}-currency`}
              status={status("currency")}
              error={commits.error.currency}
            >
              <CurrencySelect
                id={`${id}-currency`}
                value={field.valueCurrency ?? ""}
                onValueChange={(valueCurrency) =>
                  void onCommit("currency", { valueCurrency: valueCurrency || null })
                }
              />
            </Control>
            <Control
              label={<FormattedMessage id="autoDocs.valueCadence" defaultMessage="Cadence" />}
              htmlFor={`${id}-cadence`}
              status={status("cadence")}
              error={commits.error.cadence}
            >
              <select
                id={`${id}-cadence`}
                className={CONTROL_CLASS}
                value={field.valueCadence ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    value === "" ||
                    value === "one_time" ||
                    value === "monthly" ||
                    value === "annually"
                  )
                    void onCommit("cadence", { valueCadence: value || null });
                }}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "autoDocs.chooseCadence",
                    defaultMessage: "Choose a cadence",
                  })}
                </option>
                {(["one_time", "monthly", "annually"] as const).map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {intl.formatMessage(
                      {
                        id: "autoDocs.cadenceName",
                        defaultMessage:
                          "{cadence, select, one_time {One time} monthly {Monthly} other {Annually}}",
                      },
                      { cadence },
                    )}
                  </option>
                ))}
              </select>
            </Control>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-required`}
            checked={field.required}
            onCheckedChange={(checked) => void onCommit("required", { required: checked === true })}
          />
          <label htmlFor={`${id}-required`} className="text-sm font-medium">
            <FormattedMessage id="autoDocs.fieldRequired" defaultMessage="Required" />
          </label>
          <StatusNote status={status("required")} detail={commits.error.required} />
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-2 border-t border-border-muted pt-3">
        <span className="text-xs text-muted">
          <FormattedMessage
            id="autoDocs.fieldUsage"
            defaultMessage="{clauses, plural, =0 {} one {Used by # Clause rule} other {Used by # Clause rules}}{both, select, true {, } other {}}{assignments, plural, =0 {} one {Used by # Assignment rule} other {Used by # Assignment rules}}{none, select, true {Used by no rule} other {}}"
            values={{
              clauses: clauseUses,
              assignments: assignmentUses,
              both: clauseUses > 0 && assignmentUses > 0,
              none: clauseUses === 0 && assignmentUses === 0,
            }}
          />
        </span>
        {!disabled && (
          <Button variant="ghost" size="sm" className="text-status-danger-fg" onClick={onRemove}>
            <FormattedMessage id="common.remove" defaultMessage="Remove" />
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

function RuleCard({
  blockName,
  present,
  fields,
  rule,
  disabled,
  commits,
  onCommit,
}: {
  blockName: string;
  present: boolean;
  fields: AutoDocField[];
  rule: AutoDocClauseRule | undefined;
  disabled: boolean;
  commits: Commits;
  onCommit: (rule: AutoDocClauseRule | null) => Promise<CommitOutcome>;
}) {
  const intl = useIntl();
  const key = `block:${blockName}`;
  const [draft, setDraft] = useState<AutoDocClauseRule | undefined>(rule);
  const field = fields.find((row) => row.slug === draft?.fieldSlug);
  const id = `auto-doc-rule-${blockName}`;
  const typed = !!field && !field.options && field.fieldType !== "boolean";
  function change(next: AutoDocClauseRule, commitNow: boolean) {
    setDraft(next);
    if (commitNow) void onCommit(next);
  }
  return (
    <SettingsCard region title={blockName}>
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        {!present && (
          <p className="text-sm text-status-danger-fg">
            <FormattedMessage
              id="autoDocs.missingBlockCaption"
              defaultMessage="The current file has no Block with this name. Remove the rule or publish an earlier file version."
            />
          </p>
        )}
        <Control
          label={<FormattedMessage id="autoDocs.includeBlock" defaultMessage="Include" />}
          htmlFor={`${id}-include`}
          status={commits.status[key] ?? "idle"}
          error={commits.error[key]}
        >
          <select
            id={`${id}-include`}
            className={CONTROL_CLASS}
            value={draft ? "conditional" : "always"}
            onChange={(event) => {
              if (event.target.value === "always") {
                setDraft(undefined);
                void onCommit(null);
              } else {
                // The row says "when" at once, with the first field and a
                // default value; a typed value then commits on blur.
                const first = fields[0];
                change(
                  {
                    blockName,
                    fieldSlug: first?.slug ?? "",
                    operator: "equals",
                    value: defaultRuleValue("equals", first),
                  },
                  true,
                );
              }
            }}
          >
            <option value="always">
              {intl.formatMessage({ id: "autoDocs.alwaysInclude", defaultMessage: "Always" })}
            </option>
            <option value="conditional" disabled={!fields.length || !present}>
              {intl.formatMessage({
                id: "autoDocs.whenRuleMatches",
                defaultMessage: "When a rule matches",
              })}
            </option>
          </select>
        </Control>
        {draft && (
          <div
            className="flex flex-col gap-4"
            onBlur={(event) => {
              // A typed value commits when focus leaves the rule, so a
              // person can finish typing before the form version is written.
              if (!typed) return;
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              if (JSON.stringify(draft) !== JSON.stringify(rule)) void onCommit(draft);
            }}
          >
            <Control
              label={<FormattedMessage id="autoDocs.ruleField" defaultMessage="Form field" />}
              htmlFor={`${id}-field`}
              status="idle"
            >
              <select
                id={`${id}-field`}
                className={CONTROL_CLASS}
                value={draft.fieldSlug}
                onChange={(event) => {
                  const next = fields.find((row) => row.slug === event.target.value);
                  change(
                    {
                      ...draft,
                      fieldSlug: event.target.value,
                      value: defaultRuleValue(draft.operator, next),
                    },
                    !!next &&
                      (!!next.options ||
                        next.fieldType === "boolean" ||
                        draft.operator === "is_set"),
                  );
                }}
              >
                {!field && (
                  <option value={draft.fieldSlug}>
                    {intl.formatMessage({
                      id: "autoDocs.missingRuleField",
                      defaultMessage: "Missing field",
                    })}
                  </option>
                )}
                {fields.map((row) => (
                  <option key={row.slug} value={row.slug}>
                    {row.label}
                  </option>
                ))}
              </select>
            </Control>
            <Control
              label={<FormattedMessage id="autoDocs.operator" defaultMessage="Operator" />}
              htmlFor={`${id}-operator`}
              status="idle"
            >
              <select
                id={`${id}-operator`}
                className={CONTROL_CLASS}
                value={draft.operator}
                onChange={(event) => {
                  const parsed = autoDocClauseRule.shape.operator.safeParse(event.target.value);
                  if (!parsed.success) return;
                  const operator = parsed.data;
                  change(
                    { ...draft, operator, value: defaultRuleValue(operator, field) },
                    operator === "is_set" || !typed,
                  );
                }}
              >
                {OPERATORS.map((operator) => (
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
            </Control>
            <RuleValueInput
              field={field}
              fieldSlug={draft.fieldSlug}
              operator={draft.operator}
              value={draft.value}
              onChange={(value) => change({ ...draft, value }, !typed)}
            />
          </div>
        )}
      </fieldset>
    </SettingsCard>
  );
}
