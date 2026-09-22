// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings (DES-087 clause 5): four cards on DES-017's per-field commit.
 * Reach, Acknowledgement, Output, and Contract creation, the last with
 * the Assignment rules table and its dialog. No Save buttons.
 */
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { Label } from "../ui/label";
import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";
import type { paths } from "@openlaw/api-client";
import { api } from "../../lib/api";
import {
  autoDocClauseRule,
  type AutoDocAnswer,
  type AutoDocAssignmentRule,
  type AutoDocField,
  type AutoDocOptions,
} from "../../lib/auto-docs";
import { useFieldCommit, type FieldStatus } from "../../lib/field-commit";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { KnowledgeMarkdown } from "../knowledge/markdown";
import { ListEditor } from "../list-editor";
import { SettingsCard } from "../settings-card";
import { StatusNote } from "../status-note";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { defaultRuleValue, RuleValueInput } from "./rule-value-input";
import { useRuleWords } from "./rule-words";
import { TitlePatternInput } from "./title-pattern-input";

type Patch = paths["/api/v1/auto-docs/{id}"]["patch"]["requestBody"]["content"]["application/json"];
type RuleInput = Omit<AutoDocAssignmentRule, "id" | "displayOrder"> & { id?: string };

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
        <Label htmlFor={htmlFor} help={caption}>
          {label}
        </Label>
        <StatusNote status={status} detail={error} />
      </div>
      {children}
    </div>
  );
}

export function SettingsCards({
  record,
  options,
  onSaved,
}: {
  record: AutoDocAnswer;
  options: AutoDocOptions;
  onSaved: (record: AutoDocAnswer) => void;
}) {
  const intl = useIntl();
  const words = useRuleWords();
  const commits = useFieldCommit<string>();
  const archived = record.autoDoc.state === "archived";
  const doc = record.autoDoc;
  const fields = record.formVersion?.definition.fields ?? [];
  const [coverNote, setCoverNote] = useState(doc.coverNote ?? "");
  const [titlePattern, setTitlePattern] = useState(doc.titlePattern ?? "");
  const [ackText, setAckText] = useState(doc.acknowledgementText ?? "");
  // The radio answers at once; the commit behind it is what the record
  // holds. A refusal prints beside the pair and the record's own value
  // is what the next render reads.
  const [customText, setCustomText] = useState(doc.acknowledgementText !== null);
  const [ruleDialog, setRuleDialog] = useState<{
    rule: AutoDocAssignmentRule | null;
    index: number;
  } | null>(null);
  const status = (key: string) => commits.status[key] ?? "idle";
  const patch = (key: string, body: Patch) =>
    commits.commit(
      key,
      () => api.PATCH("/api/v1/auto-docs/{id}", { params: { path: { id: doc.id } }, body }),
      onSaved,
    );
  const saveRules = (key: string, rules: RuleInput[], defaultLegalOwnerId: string | null) =>
    commits.commit(
      key,
      () =>
        api.PUT("/api/v1/auto-docs/{id}/assignment-rules", {
          params: { path: { id: doc.id } },
          body: {
            rules: rules.map((rule) => ({
              id: rule.id,
              fieldSlug: rule.fieldSlug,
              operator: rule.operator,
              value: rule.value,
              legalOwnerId: rule.legalOwnerId,
            })),
            defaultLegalOwnerId,
          },
        }),
      onSaved,
    );
  const textCommit = (
    key: string,
    draft: string,
    saved: string,
    reset: (value: string) => void,
    body: (value: string) => Patch,
  ) => ({
    onBlur: () =>
      commits.commitText(key, { draft, saved, reset, send: (value) => patch(key, body(value)) }),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") commits.revertText(key, { draft, saved, reset, send: () => {} });
    },
  });
  const multi = (
    key: string,
    id: string,
    label: ReactNode,
    value: string[],
    choices: readonly { id: string; displayName: string }[],
    unavailable: string,
    body: (ids: string[]) => Patch,
    caption?: ReactNode,
  ) => (
    <Control
      label={label}
      htmlFor={id}
      status={status(key)}
      error={commits.error[key]}
      caption={caption}
    >
      <select
        id={id}
        multiple
        className={`${CONTROL_CLASS} h-auto min-h-24`}
        value={value}
        onChange={(event) =>
          void patch(key, body([...event.target.selectedOptions].map((option) => option.value)))
        }
      >
        {value
          .filter((chosen) => !choices.some((choice) => choice.id === chosen))
          .map((chosen) => (
            <option key={chosen} value={chosen}>
              {unavailable}
            </option>
          ))}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.displayName}
          </option>
        ))}
      </select>
    </Control>
  );
  // ADO-008's addendum names the Portal problems Legal must fix. Each
  // lands on the card it concerns: an Entity problem on Contract
  // creation, everything else on Reach.
  const entityWarnings = record.portalWarnings.filter((warning) => /entity/i.test(warning));
  const reachWarnings = record.portalWarnings.filter((warning) => !/entity/i.test(warning));
  const warningLines = (lines: string[]) =>
    lines.length ? (
      <div role="status" className="flex flex-col gap-1">
        {lines.map((line) => (
          <p key={line} className="text-sm text-status-warning-fg">
            {line}
          </p>
        ))}
      </div>
    ) : null;
  const legalOwnerName = (id: string) =>
    options.legalOwners.find((owner) => owner.id === id)?.displayName ??
    intl.formatMessage({
      id: "autoDocs.unavailableLegalOwner",
      defaultMessage: "Unavailable Legal Owner",
    });
  const targetType = options.contractTypes.find((type) => type.id === doc.targetContractTypeId);
  const ruleIndex = (id: string) => record.assignmentRules.findIndex((rule) => rule.id === id);

  return (
    <fieldset disabled={archived} className="flex flex-col gap-4">
      <SettingsCard region title={<FormattedMessage id="autoDocs.reach" defaultMessage="Reach" />}>
        <Control
          label={<FormattedMessage id="autoDocs.audience" defaultMessage="Audience" />}
          htmlFor="auto-doc-audience"
          status={status("audience")}
          error={commits.error.audience}
        >
          <select
            id="auto-doc-audience"
            className={CONTROL_CLASS}
            value={doc.audience}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "legal_only" || value === "selected" || value === "everyone")
                void patch("audience", { audience: value });
            }}
          >
            {(["legal_only", "selected", "everyone"] as const).map((audience) => (
              <option key={audience} value={audience}>
                {intl.formatMessage(
                  {
                    id: "autoDocs.audienceName",
                    defaultMessage:
                      "{audience, select, legal_only {Legal only} selected {Selected} other {Everyone}}",
                  },
                  { audience },
                )}
              </option>
            ))}
          </select>
        </Control>
        {doc.audience === "selected" && (
          <>
            {multi(
              "audienceUserIds",
              "auto-doc-audience-people",
              <FormattedMessage id="autoDocs.audiencePeople" defaultMessage="People" />,
              record.audienceUserIds,
              options.audienceUsers,
              intl.formatMessage({
                id: "autoDocs.unavailablePerson",
                defaultMessage: "Unavailable person",
              }),
              (ids) => ({ audienceUserIds: ids }),
            )}
            {multi(
              "audienceDepartmentIds",
              "auto-doc-audience-departments",
              <FormattedMessage id="autoDocs.audienceDepartments" defaultMessage="Departments" />,
              record.audienceDepartmentIds,
              options.departments,
              intl.formatMessage({
                id: "autoDocs.unavailableDepartment",
                defaultMessage: "Archived Department",
              }),
              (ids) => ({ audienceDepartmentIds: ids }),
              <FormattedMessage
                id="autoDocs.selectedAudienceCaption"
                defaultMessage="A person named here, or in a Department named here, sees this Auto-Doc in the Portal."
              />,
            )}
          </>
        )}
        {warningLines(reachWarnings)}
      </SettingsCard>

      <SettingsCard
        region
        title={<FormattedMessage id="autoDocs.acknowledgement" defaultMessage="Acknowledgement" />}
      >
        <p className="text-sm text-muted">
          <FormattedMessage
            id="autoDocs.acknowledgementPolicyHelp"
            defaultMessage="Acknowledgement frequency can be adjusted in <settings>Organization Auto-Doc Settings</settings>."
            values={{
              // Underlined at rest, like every other link inside prose:
              // colour alone against muted body text fails WCAG 1.4.1
              // (axe link-in-text-block).
              settings: (chunks) => (
                <Link to="/settings/auto-docs" className="text-link underline">
                  {chunks}
                </Link>
              ),
            }}
          />
        </p>
        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-labelledby="auto-doc-ack-text-label"
        >
          <div className="flex items-center justify-between gap-2">
            <span id="auto-doc-ack-text-label" className="text-sm font-medium">
              <FormattedMessage id="autoDocs.acknowledgementText" defaultMessage="Text" />
            </span>
            <StatusNote
              status={status("acknowledgementText")}
              detail={commits.error.acknowledgementText}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="auto-doc-ack-source"
              checked={!customText}
              onChange={() => {
                setCustomText(false);
                void patch("acknowledgementText", { acknowledgementText: null });
              }}
            />
            <FormattedMessage
              id="autoDocs.orgAcknowledgement"
              defaultMessage="Organization's text"
            />
          </label>
          {doc.acknowledgementText === null && (
            <p className="ms-6 text-sm whitespace-pre-wrap text-muted">
              {record.defaultAcknowledgementText}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="auto-doc-ack-source"
              checked={customText}
              onChange={() => {
                setCustomText(true);
                setAckText(record.defaultAcknowledgementText);
                void patch("acknowledgementText", {
                  acknowledgementText: record.defaultAcknowledgementText,
                });
              }}
            />
            <FormattedMessage id="autoDocs.customAcknowledgement" defaultMessage="Custom text" />
          </label>
          {customText && (
            <div className="ms-6 flex flex-col gap-1">
              <AutoResizeTextarea
                aria-label={intl.formatMessage({
                  id: "autoDocs.acknowledgementTextField",
                  defaultMessage: "Acknowledgement text",
                })}
                className={TEXTAREA_CLASS}
                maxLength={10_000}
                value={ackText}
                onChange={(event) => setAckText(event.target.value)}
                onBlur={() =>
                  commits.commitText("acknowledgementText", {
                    draft: ackText,
                    saved: doc.acknowledgementText ?? "",
                    required: true,
                    reset: setAckText,
                    send: (value) => patch("acknowledgementText", { acknowledgementText: value }),
                  })
                }
              />
              <span className="text-xs text-muted">
                <FormattedMessage
                  id="autoDocs.acknowledgementCaption"
                  defaultMessage="Changing the text asks everyone to acknowledge it again."
                />
              </span>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        region
        title={<FormattedMessage id="autoDocs.output" defaultMessage="Output" />}
      >
        <Control
          label={<FormattedMessage id="autoDocs.formats" defaultMessage="Formats" />}
          htmlFor="auto-doc-formats"
          status={status("formats")}
          error={commits.error.formats}
        >
          <select
            id="auto-doc-formats"
            className={CONTROL_CLASS}
            value={doc.formats}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "docx" || value === "pdf" || value === "both")
                void patch("formats", { formats: value });
            }}
          >
            {(["docx", "pdf", "both"] as const).map((format) => (
              <option key={format} value={format}>
                {intl.formatMessage(
                  {
                    id: "autoDocs.formatName",
                    defaultMessage: "{format, select, docx {Word} pdf {PDF} other {Word and PDF}}",
                  },
                  { format },
                )}
              </option>
            ))}
          </select>
        </Control>
        <Control
          label={<FormattedMessage id="autoDocs.coverNote" defaultMessage="Cover note" />}
          htmlFor="auto-doc-cover-note"
          status={status("coverNote")}
          error={commits.error.coverNote}
          caption={
            <FormattedMessage
              id="autoDocs.coverNoteCaption"
              defaultMessage="Write a message to include in the email with the generated files."
            />
          }
        >
          <AutoResizeTextarea
            id="auto-doc-cover-note"
            className={TEXTAREA_CLASS}
            maxLength={10_000}
            value={coverNote}
            onChange={(event) => setCoverNote(event.target.value)}
            {...textCommit("coverNote", coverNote, doc.coverNote ?? "", setCoverNote, (value) => ({
              coverNote: value || null,
            }))}
          />
        </Control>
        {coverNote.trim() && <KnowledgeMarkdown source={coverNote} />}
      </SettingsCard>

      <SettingsCard
        region
        title={
          <FormattedMessage id="autoDocs.contractCreation" defaultMessage="Contract creation" />
        }
      >
        <Control
          label={
            <FormattedMessage id="autoDocs.targetType" defaultMessage="Target Contract Type" />
          }
          htmlFor="auto-doc-target-type"
          status={status("targetContractTypeId")}
          error={commits.error.targetContractTypeId}
          caption={
            doc.targetContractTypeId ? undefined : (
              <FormattedMessage
                id="autoDocs.noTargetCaption"
                defaultMessage="Without a target, a Generation's file stays on the Generation until it is Filed."
              />
            )
          }
        >
          <select
            id="auto-doc-target-type"
            className={CONTROL_CLASS}
            value={doc.targetContractTypeId ?? ""}
            onChange={(event) =>
              void patch("targetContractTypeId", {
                targetContractTypeId: event.target.value || null,
              })
            }
          >
            <option value="">
              {intl.formatMessage({
                id: "autoDocs.noTargetType",
                defaultMessage: "No target Contract Type",
              })}
            </option>
            {doc.targetContractTypeId && !targetType && (
              <option value={doc.targetContractTypeId}>
                {intl.formatMessage({
                  id: "autoDocs.archivedTargetType",
                  defaultMessage: "Archived Contract Type",
                })}
              </option>
            )}
            {options.contractTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.displayName}
              </option>
            ))}
          </select>
        </Control>
        {doc.targetContractTypeId && (
          <>
            <Control
              label={<FormattedMessage id="autoDocs.titlePattern" defaultMessage="Title pattern" />}
              htmlFor="auto-doc-title-pattern"
              status={status("titlePattern")}
              error={commits.error.titlePattern}
            >
              <TitlePatternInput
                id="auto-doc-title-pattern"
                fields={fields}
                value={titlePattern}
                onChange={setTitlePattern}
                {...textCommit(
                  "titlePattern",
                  titlePattern,
                  doc.titlePattern ?? "",
                  setTitlePattern,
                  (value) => ({ titlePattern: value || null }),
                )}
              />
            </Control>
            <Control
              label={<FormattedMessage id="autoDocs.fixedEntity" defaultMessage="Our Entity" />}
              htmlFor="auto-doc-fixed-entity"
              status={status("fixedEntityId")}
              error={commits.error.fixedEntityId}
            >
              <select
                id="auto-doc-fixed-entity"
                className={CONTROL_CLASS}
                value={doc.fixedEntityId ?? ""}
                onChange={(event) =>
                  void patch("fixedEntityId", { fixedEntityId: event.target.value || null })
                }
              >
                <option value="">
                  {intl.formatMessage({
                    id: "autoDocs.entityFromForm",
                    defaultMessage: "From the form",
                  })}
                </option>
                {doc.fixedEntityId &&
                  !options.entities.some((entity) => entity.id === doc.fixedEntityId) && (
                    <option value={doc.fixedEntityId}>
                      {intl.formatMessage({
                        id: "autoDocs.unavailableEntity",
                        defaultMessage: "Unavailable Entity",
                      })}
                    </option>
                  )}
                {options.entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </Control>
            <Control
              label={
                <FormattedMessage
                  id="autoDocs.defaultLegalOwner"
                  defaultMessage="Default Legal Owner"
                />
              }
              htmlFor="auto-doc-default-owner"
              status={status("defaultLegalOwnerId")}
              error={commits.error.defaultLegalOwnerId}
            >
              <select
                id="auto-doc-default-owner"
                className={CONTROL_CLASS}
                value={doc.defaultLegalOwnerId ?? ""}
                onChange={(event) =>
                  void saveRules(
                    "defaultLegalOwnerId",
                    record.assignmentRules,
                    event.target.value || null,
                  )
                }
              >
                <option value="">
                  {intl.formatMessage({
                    id: "autoDocs.noDefaultOwner",
                    defaultMessage: "None, leave unassigned",
                  })}
                </option>
                {doc.defaultLegalOwnerId &&
                  !options.legalOwners.some((owner) => owner.id === doc.defaultLegalOwnerId) && (
                    <option value={doc.defaultLegalOwnerId}>
                      {legalOwnerName(doc.defaultLegalOwnerId)}
                    </option>
                  )}
                {options.legalOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </Control>
            <ListEditor
              region
              rows={record.assignmentRules.map((rule) => ({
                ...rule,
                displayName: words(rule, fields),
                archivedAt: null,
              }))}
              title={
                <FormattedMessage id="autoDocs.assignmentRules" defaultMessage="Assignment rules" />
              }
              count={
                <FormattedMessage
                  id="autoDocs.ruleCount"
                  defaultMessage="{count, plural, one {# rule} other {# rules}}"
                  values={{ count: record.assignmentRules.length }}
                />
              }
              addLabel={<FormattedMessage id="autoDocs.assignmentAdd" defaultMessage="Add rule" />}
              onAdd={
                archived ||
                !fields.length ||
                !options.legalOwners.length ||
                record.assignmentRules.length >= 100
                  ? undefined
                  : () => setRuleDialog({ rule: null, index: record.assignmentRules.length })
              }
              help={
                <FormattedMessage
                  id="autoDocs.assignmentCaption"
                  defaultMessage="The first matching rule names the Legal Owner. Without a match or a default, the Contract remains unassigned."
                />
              }
              rowStatus={Object.fromEntries(
                record.assignmentRules.map((rule) => [rule.id, status(`rule:${rule.id}`)]),
              )}
              rowError={Object.fromEntries(
                record.assignmentRules.map((rule) => [rule.id, commits.error[`rule:${rule.id}`]]),
              )}
              rowCaption={(row) => legalOwnerName(row.legalOwnerId)}
              rowActions={(row) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1.5"
                  aria-label={intl.formatMessage(
                    { id: "autoDocs.editAssignmentRule", defaultMessage: "Edit rule {number}" },
                    { number: ruleIndex(row.id) + 1 },
                  )}
                  onClick={() =>
                    setRuleDialog({
                      rule: record.assignmentRules[ruleIndex(row.id)] ?? null,
                      index: ruleIndex(row.id),
                    })
                  }
                >
                  <Pencil size={16} aria-hidden="true" className="text-muted" />
                </Button>
              )}
              removeLabel={(row) =>
                intl.formatMessage(
                  { id: "autoDocs.removeAssignmentRule", defaultMessage: "Remove rule {number}" },
                  { number: ruleIndex(row.id) + 1 },
                )
              }
              onRemove={
                archived
                  ? undefined
                  : (row) =>
                      void saveRules(
                        `rule:${row.id}`,
                        record.assignmentRules.filter((rule) => rule.id !== row.id),
                        doc.defaultLegalOwnerId,
                      )
              }
              reorder={
                archived
                  ? undefined
                  : {
                      status: status("ruleOrder"),
                      detail: commits.error.ruleOrder,
                      gripLabel: (row, position, total) =>
                        intl.formatMessage(
                          {
                            id: "autoDocs.ruleGrip",
                            defaultMessage: "Reorder rule {position} of {total}",
                          },
                          { position, total },
                        ),
                      onMove: (from, to) => {
                        const next = [...record.assignmentRules];
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved!);
                        void saveRules("ruleOrder", next, doc.defaultLegalOwnerId);
                      },
                    }
              }
            />
          </>
        )}
        {warningLines(entityWarnings)}
      </SettingsCard>
      {ruleDialog && (
        <AssignmentRuleDialog
          rule={ruleDialog.rule}
          fields={fields}
          legalOwners={options.legalOwners}
          onClose={() => setRuleDialog(null)}
          onSave={async (next) => {
            const rules = [...record.assignmentRules] as RuleInput[];
            if (ruleDialog.rule) rules[ruleDialog.index] = { ...ruleDialog.rule, ...next };
            else rules.push(next);
            const outcome = await saveRules(
              ruleDialog.rule ? `rule:${ruleDialog.rule.id}` : "ruleAdd",
              rules,
              doc.defaultLegalOwnerId,
            );
            return outcome.ok ? undefined : outcome.detail;
          }}
        />
      )}
    </fieldset>
  );
}

function AssignmentRuleDialog({
  rule,
  fields,
  legalOwners,
  onClose,
  onSave,
}: {
  rule: AutoDocAssignmentRule | null;
  fields: AutoDocField[];
  legalOwners: readonly { id: string; displayName: string }[];
  onClose: () => void;
  onSave: (rule: Omit<RuleInput, "id">) => Promise<string | undefined>;
}) {
  const intl = useIntl();
  const first = fields[0];
  const [draft, setDraft] = useState<Omit<RuleInput, "id">>(
    rule ?? {
      fieldSlug: first?.slug ?? "",
      operator: "equals",
      value: defaultRuleValue("equals", first),
      legalOwnerId: legalOwners[0]?.id ?? "",
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const field = fields.find((row) => row.slug === draft.fieldSlug);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {rule ? (
            <FormattedMessage id="autoDocs.editAssignmentRuleTitle" defaultMessage="Edit rule" />
          ) : (
            <FormattedMessage id="autoDocs.assignmentAdd" defaultMessage="Add rule" />
          )}
        </DialogTitle>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(undefined);
            void onSave(draft).then((refusal) => {
              setBusy(false);
              if (refusal) setError(refusal);
              else onClose();
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              <FormattedMessage id="autoDocs.ruleField" defaultMessage="Form field" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={draft.fieldSlug}
              onChange={(event) => {
                const next = fields.find((row) => row.slug === event.target.value);
                setDraft({
                  ...draft,
                  fieldSlug: event.target.value,
                  value: defaultRuleValue(draft.operator, next),
                });
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
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              <FormattedMessage id="autoDocs.operator" defaultMessage="Operator" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={draft.operator}
              onChange={(event) => {
                const parsed = autoDocClauseRule.shape.operator.safeParse(event.target.value);
                if (!parsed.success) return;
                setDraft({
                  ...draft,
                  operator: parsed.data,
                  value: defaultRuleValue(parsed.data, field),
                });
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
            fieldSlug={draft.fieldSlug}
            operator={draft.operator}
            value={draft.value}
            onChange={(value) => setDraft({ ...draft, value })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              <FormattedMessage id="autoDocs.legalOwner" defaultMessage="Legal Owner" />
            </span>
            <select
              required
              className={CONTROL_CLASS}
              value={draft.legalOwnerId}
              onChange={(event) => setDraft({ ...draft, legalOwnerId: event.target.value })}
            >
              {draft.legalOwnerId &&
                !legalOwners.some((owner) => owner.id === draft.legalOwnerId) && (
                  <option value={draft.legalOwnerId}>
                    {intl.formatMessage({
                      id: "autoDocs.unavailableLegalOwner",
                      defaultMessage: "Unavailable Legal Owner",
                    })}
                  </option>
                )}
              {legalOwners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.displayName}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="common.save" defaultMessage="Save" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
