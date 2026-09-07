// SPDX-License-Identifier: AGPL-3.0-only

/** Prefilled conversion form. Edits apply to the new record when conversion succeeds. */

import { CreateAttachments, useCreateAttachments } from "../documents/create-attachments";
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ArrowRightLeft, FilePen } from "lucide-react";
import {
  MAX_CONTRACT_TITLE_LENGTH,
  MAX_MATTER_TITLE_LENGTH,
  type RequestOutcome,
} from "@openlaw/shared";
import {
  contractReference,
  severityLabel,
  SEVERITY_LEVELS,
  type ContractTypeOption,
} from "../../lib/contracts";
import { matterReference, type MatterTypeOption } from "../../lib/matters";
import {
  isAnswered,
  toDraft,
  toValue,
  type AttachedField,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../../lib/custom-fields";
import { CONTROL_CLASS } from "../../lib/form-controls";
import type {
  ConvertedRecord,
  StaffRequest,
  StaffRequestField,
  StaffRequestFieldRefs,
} from "../../lib/requests";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { customFieldValueText, isArchivedCustomFieldReference } from "./custom-field-value";

/** The error line's id, named on the box a refusal is about so a screen
 * reader reads the two together (DES-011). */
const TITLE_ERROR_ID = "convert-title-error";

/**
 * What the dialog answers back to the page that opened it.
 *
 * The same three arms Decline's and Resolve's results have, plus the
 * record a lost race names — the one thing Convert asked the scaffold
 * to say.
 */

export type ConvertResult =
  /** It landed. The page repaints from the envelope the write answered. */
  | { ok: true; request: StaffRequest }
  /** Somebody else decided first, and this is what they decided. */
  | {
      ok: false;
      alreadyDecided: RequestOutcome;
      convertedRecord: ConvertedRecord | null;
    }
  /** Any other refusal, in the seam's own words where it gave any. */
  | { ok: false; alreadyDecided?: undefined; detail?: string };

export function ConvertDialog({
  initialTargetModule,
  reference,
  request,
  fields,
  customFieldRefs,
  contractTypes,
  matterTypes,
  people,
  entities,
  busy,
  onClose,
  onConvert,
}: Readonly<{
  /** The Request's R-### reference, which the title quotes. */
  reference: string;
  initialTargetModule?: "contract" | "matter";
  request: StaffRequest;
  /** The request type's own attached fields — what the form collected,
   * and the labels the collected values are named by. */
  fields: readonly StaffRequestField[];
  customFieldRefs: StaffRequestFieldRefs;
  /** The live contract types, each with the fields it attaches. */
  contractTypes: readonly ContractTypeOption[];
  /** The live matter taxonomy, in the same attached-field shape. */
  matterTypes: readonly MatterTypeOption[];
  /** What a `user` creation field offers. */
  people: readonly FieldReference[];
  /** What an `entity` creation field offers — the M7 registry. */
  entities: readonly FieldReference[];
  busy: boolean;
  onClose: () => void;
  onConvert: (input: {
    title: string;
    contractTypeId?: string;
    matterTypeId?: string;
    templateId?: string;
    priority?: StaffRequest["urgency"];
    customFields?: Record<string, CustomFieldValue | null>;
  }) => Promise<ConvertResult>;
}>) {
  const intl = useIntl();
  const attachments = useCreateAttachments();

  type TargetModule = "contract" | "matter";
  const initialModule: TargetModule =
    initialTargetModule ?? request.requestType.targetModule ?? "contract";
  const [targetModule, setTargetModule] = useState<TargetModule>(initialModule);
  const targetTypes = targetModule === "contract" ? contractTypes : matterTypes;
  /** The picker's value, and the empty string until a deferred target
   * has been answered. Seeded once: a prefill that re-applied itself
   * would take back an edit. */
  const [pickedIds, setPickedIds] = useState<Record<TargetModule, string>>({
    contract:
      request.requestType.targetModule === "contract"
        ? (request.requestType.targetTypeId ?? "")
        : "",
    matter:
      request.requestType.targetModule === "matter" ? (request.requestType.targetTypeId ?? "") : "",
  });
  const pickedId = pickedIds[targetModule];
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState(request.summary);
  const [priority, setPriority] = useState(request.urgency);
  /** The creation fields' drafts, keyed by slug. They survive switching
   * types and back — a value typed once should not have to be typed
   * again because somebody checked another type on the way. */
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>({});
  /** What is wrong, and whether it is about the title box. A refusal the
   * seam gave belongs to no control — it is about the write — so only
   * the one the form itself checks marks a box. */
  const [error, setError] = useState<{ onTitle: boolean; message: string } | null>(null);
  /** The decision somebody else recorded first, once the seam has said
   * so. Set, the dialog stops being a form and becomes a statement. */
  const [alreadyDecided, setAlreadyDecided] = useState<{
    outcome: RequestOutcome;
    convertedRecord: ConvertedRecord | null;
  } | null>(null);

  const target = targetTypes.find((option) => option.id === pickedId) ?? null;
  const targetFields = target?.fields ?? [];
  const matterTarget = targetModule === "matter" ? (target as MatterTypeOption | null) : null;
  const templates = matterTarget?.templates ?? [];
  const selectedTemplate = templates.find((template) => template.id === templateId);

  /** Template defaults sit below both carried Request values and what
   * the triager types. `drafts` holds only the latter, so changing a
   * Template changes an untouched default without taking back an edit. */
  function seedTemplate(type: MatterTypeOption, nextTemplateId: string) {
    const template = type.templates?.find((candidate) => candidate.id === nextTemplateId);
    setTemplateId(template?.id ?? "");
    setError(null);
  }

  const archivedCarrySlugs = new Set(
    targetFields
      .filter(
        (field) =>
          isAnswered(request.customFields[field.slug]) &&
          isArchivedCustomFieldReference(field, request.customFields[field.slug]!, customFieldRefs),
      )
      .map((field) => field.slug),
  );
  const staysBehind = fields.filter(
    (field) =>
      isAnswered(request.customFields[field.slug]) &&
      !targetFields.some((attached) => attached.slug === field.slug),
  );
  // Keep live carried references labelled even when an options read omits them.
  const fieldPeople = [
    ...people,
    ...customFieldRefs.users
      .filter((row) => !row.archived && !people.some((person) => person.id === row.id))
      .map((row) => ({ id: row.id, label: row.displayName })),
  ];
  const fieldEntities = [
    ...entities,
    ...customFieldRefs.entities
      .filter(
        (row) =>
          !row.restricted && !row.archived && !entities.some((entity) => entity.id === row.id),
      )
      .flatMap((row) => (row.restricted ? [] : [{ id: row.id, label: row.legalName }])),
  ];

  function fieldDraft(field: AttachedField): CustomFieldDraft {
    const edited = drafts[field.slug];
    if (edited !== undefined) return edited;
    if (archivedCarrySlugs.has(field.slug)) return toDraft(field, undefined);
    return toDraft(
      field,
      request.customFields[field.slug] ?? selectedTemplate?.defaultCustomFields[field.slug],
    );
  }

  async function submit() {
    if (busy || attachments.created) return;
    const named = title.trim();
    if (named === "") {
      setError({
        onTitle: true,
        message: intl.formatMessage(
          {
            id: "convert.needTitle",
            defaultMessage: "Name the {module, select, matter {matter} other {contract}}.",
          },
          { module: targetModule },
        ),
      });
      return;
    }
    if (target === null) {
      setError({
        onTitle: false,
        message: intl.formatMessage(
          {
            id: "convert.needType",
            defaultMessage: "Pick a {module, select, matter {matter} other {contract}} type.",
          },
          { module: targetModule },
        ),
      });
      return;
    }
    // The target type's own demands, checked where somebody can answer
    // them. The seam refuses an empty one too — this saves a round trip
    // and names the field (DES-035 clause 12).
    const customFields: Record<string, CustomFieldValue | null> = {};
    for (const field of targetFields) {
      const parsed = toValue(field, fieldDraft(field));
      if ("error" in parsed) {
        setError({
          onTitle: false,
          message: intl.formatMessage(
            {
              id: "contracts.field.numberInvalidNamed",
              defaultMessage: "{fieldName}: enter this as a number.",
            },
            { fieldName: field.displayName },
          ),
        });
        return;
      }
      if (
        parsed.value === null &&
        (field.isRequired ||
          (archivedCarrySlugs.has(field.slug) && drafts[field.slug] === undefined))
      ) {
        setError({
          onTitle: false,
          message: archivedCarrySlugs.has(field.slug)
            ? intl.formatMessage(
                {
                  id: "convert.archivedReferenceMissing",
                  defaultMessage: "Pick a live value for {field}.",
                },
                { field: field.displayName },
              )
            : intl.formatMessage(
                {
                  id: "convert.fieldMissing",
                  defaultMessage:
                    "Fill {field} — this {module, select, matter {matter} other {contract}} type requires it.",
                },
                { field: field.displayName, module: targetModule },
              ),
        });
        return;
      }
      if (drafts[field.slug] !== undefined) customFields[field.slug] = parsed.value;
    }

    const result = await onConvert({
      title: named,
      priority,
      ...(targetModule === "contract"
        ? { contractTypeId: target.id }
        : { matterTypeId: target.id }),
      ...(selectedTemplate ? { templateId: selectedTemplate.id } : {}),
      ...(Object.keys(customFields).length === 0 ? {} : { customFields }),
    });
    if (result.ok) {
      const record = result.request.convertedRecord;
      if (record) {
        await attachments.upload({ entityType: record.module, number: record.number }, onClose);
      } else onClose();
      return;
    }
    if (result.alreadyDecided) {
      setAlreadyDecided({
        outcome: result.alreadyDecided,
        convertedRecord: result.convertedRecord,
      });
      setError(null);
      return;
    }
    setError({
      onTitle: false,
      message:
        result.detail ??
        intl.formatMessage({
          id: "convert.failed",
          defaultMessage: "The request could not be converted. Try again.",
        }),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open || busy || attachments.pending) return;
        if (attachments.created) attachments.finish();
        else onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="convert.title"
            defaultMessage="Convert {reference} to a {module, select, matter {matter} other {contract}}"
            values={{ reference, module: targetModule }}
          />
        </DialogTitle>
        {attachments.created ? (
          <div className="mt-4">
            <CreateAttachments showKind={targetModule !== "matter"} uploads={attachments} />
          </div>
        ) : alreadyDecided ? (
          <div className="mt-4 flex flex-col gap-4">
            {/* The scaffold's own two lines (DES-058 clause 5), from the
                scaffold's own catalogue ids. */}
            <p className="text-sm text-muted">
              <FormattedMessage
                id="disposition.alreadyDecided"
                defaultMessage="{outcome, select, converted {Somebody else already converted this request.} resolved {Somebody else already resolved this request.} declined {Somebody else already declined this request.} other {Somebody else already decided this request.}}"
                values={{ outcome: alreadyDecided.outcome }}
              />
            </p>
            {/* The record the winner made, where the seam named one. It
                is the one thing a plain outcome cannot say, and it is
                what the loser opens instead of pressing again. */}
            {alreadyDecided.convertedRecord && (
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="convert.alreadyConvertedRecord"
                  defaultMessage="It became {record}."
                  values={{
                    record:
                      alreadyDecided.convertedRecord.module === "matter"
                        ? matterReference(intl, alreadyDecided.convertedRecord.number)
                        : contractReference(intl, alreadyDecided.convertedRecord.number),
                  }}
                />
              </p>
            )}
            <p className="text-sm text-muted">
              <FormattedMessage
                id="disposition.alreadyDecidedRead"
                defaultMessage="Close this to read what they recorded."
              />
            </p>
            <div className="flex justify-end">
              {/* Focus follows the content: the form that held it has
                  just unmounted (DES-011). */}
              <Button type="button" autoFocus onClick={onClose}>
                <FormattedMessage id="action.close" defaultMessage="Close" />
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {/* I3's opening line: which front door this came through and
                who filled it in. The reference is in the title above. */}
            <p className="text-sm text-muted">
              <FormattedMessage
                id="convert.from"
                defaultMessage="{requestType} · submitted by {requester}"
                values={{
                  requestType: request.requestType.displayName,
                  requester: request.requester.displayName,
                }}
              />
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-title" required>
                <FormattedMessage id="convert.titleField" defaultMessage="Title" />
              </Label>
              <Input
                id="convert-title"
                aria-required="true"
                autoFocus
                value={title}
                // The seam is what enforces it; the box restates it so
                // nobody types past a bound they will only meet on the
                // press. The Decline dialog's rule, applied to a title.
                maxLength={
                  targetModule === "contract" ? MAX_CONTRACT_TITLE_LENGTH : MAX_MATTER_TITLE_LENGTH
                }
                {...(error?.onTitle
                  ? { "aria-invalid": true, "aria-describedby": TITLE_ERROR_ID }
                  : {})}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-type" required>
                <FormattedMessage
                  id="convert.typeField"
                  defaultMessage="{module, select, matter {Matter} other {Contract}} type"
                  values={{ module: targetModule }}
                />
              </Label>
              <select
                id="convert-type"
                aria-required="true"
                value={pickedId}
                className={CONTROL_CLASS}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setPickedIds((current) => ({
                    ...current,
                    [targetModule]: nextId,
                  }));
                  if (targetModule === "matter") setTemplateId("");
                  if (nextId !== "") setError(null);
                }}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "contracts.form.typePlaceholder",
                    defaultMessage: "Type…",
                  })}
                </option>
                {targetTypes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                  </option>
                ))}
              </select>
            </div>
            {matterTarget && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-template">
                  <FormattedMessage id="matters.field.template" defaultMessage="Matter template" />
                </Label>
                <select
                  id="convert-template"
                  value={selectedTemplate?.id ?? ""}
                  className={CONTROL_CLASS}
                  onChange={(event) => seedTemplate(matterTarget, event.target.value)}
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "matters.template.none",
                      defaultMessage: "No template",
                    })}
                  </option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-priority" required>
                <FormattedMessage id="convert.priority" defaultMessage="Priority" />
              </Label>
              <select
                id="convert-priority"
                aria-required="true"
                value={priority}
                className={CONTROL_CLASS}
                onChange={(event) => {
                  const value = SEVERITY_LEVELS.find((level) => level === event.target.value);
                  if (value) setPriority(value);
                }}
              >
                {SEVERITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {severityLabel(intl, level)}
                  </option>
                ))}
              </select>
            </div>
            {target && staysBehind.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">
                  <FormattedMessage
                    id="convert.staysBehind"
                    defaultMessage="Does not carry into the {module, select, matter {matter} other {contract}}"
                    values={{ module: targetModule }}
                  />
                </p>
                <p className="text-xs text-muted">
                  {intl.formatList(
                    staysBehind.map((field) => field.displayName),
                    { type: "conjunction" },
                  )}
                </p>
              </div>
            )}
            {targetFields.map((field) => (
              <div key={field.slug} className="flex flex-col gap-1.5">
                <Label
                  id={`convert-${field.slug}-label`}
                  htmlFor={`convert-${field.slug}`}
                  required={field.isRequired}
                >
                  {field.displayName}
                </Label>
                <CustomFieldControl
                  id={`convert-${field.slug}`}
                  field={field}
                  draft={fieldDraft(field)}
                  people={fieldPeople}
                  entities={fieldEntities}
                  required={field.isRequired}
                  describedBy={
                    archivedCarrySlugs.has(field.slug) || field.description
                      ? `convert-${field.slug}-help`
                      : undefined
                  }
                  onDraft={(next) => {
                    setDrafts((current) => ({ ...current, [field.slug]: next }));
                    setError(null);
                  }}
                />
                {(archivedCarrySlugs.has(field.slug) || field.description) && (
                  <p id={`convert-${field.slug}-help`} className="text-xs text-muted">
                    {archivedCarrySlugs.has(field.slug) ? (
                      <FormattedMessage
                        id="convert.archivedReferenceNote"
                        defaultMessage="{value} is archived. Pick a live {fieldType, select, user {person} entity {entity} other {value}} to convert."
                        values={{
                          value: customFieldValueText(
                            intl,
                            field,
                            request.customFields[field.slug]!,
                            customFieldRefs,
                          ),
                          fieldType: field.fieldType,
                        }}
                      />
                    ) : (
                      field.description
                    )}
                  </p>
                )}
              </div>
            ))}
            <CreateAttachments
              showKind={targetModule !== "matter"}
              uploads={attachments}
              disabled={busy}
            />
            {error !== null && (
              <p id={TITLE_ERROR_ID} role="alert" className="text-xs text-status-danger-fg">
                {error.message}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setTargetModule(targetModule === "contract" ? "matter" : "contract");
                  setError(null);
                }}
              >
                <ArrowRightLeft size={16} aria-hidden="true" />
                <FormattedMessage
                  id="convert.otherModule"
                  defaultMessage="Convert to {module, select, matter {contract} other {matter}} instead"
                  values={{ module: targetModule }}
                />
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                  <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
                </Button>
                <Button type="submit" disabled={busy}>
                  <FilePen size={16} aria-hidden="true" />
                  <FormattedMessage
                    id="convert.submit"
                    defaultMessage="Convert to {module, select, matter {matter} other {contract}}"
                    values={{ module: targetModule }}
                  />
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
