// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Convert dialog (INT-002, INT-006, DD-018, #420), drawn from the
 * `Overlay` of the I3 frame in `designs/intake.pen` — the last of
 * INT-007's three dispositions, and the outcome the Inbox exists to
 * reach.
 *
 * **It is a prefilled record create, and the prefill is the point.**
 * I3 opens with a line naming where the ask came from, then a note
 * saying the form responses carry through, then the boxes. That order
 * is kept: a triager reads what is already decided before they are
 * asked for anything.
 *
 * **Triage confirms the target; it never classifies it** (DD-018). Where
 * the request type names a live type in its module, the dialog states it and
 * offers no picker, because there is nothing to pick — the Administrator
 * bound the routing at configuration. The picker appears only for the
 * one choice the form honestly deferred: a module-only target, a target
 * type the taxonomy has archived (which reads as no type), or the
 * deliberate switch to the other module. That switch is DD-018's
 * lossless **Re-target**, and the dialog says so in a line of its own.
 *
 * **What carries is named, and so is what does not.** Every collected
 * value whose slug the target type also attaches is listed with the
 * value it will land as. Every collected value with no field to land in
 * is listed too, under its own line saying it stays on the request —
 * the INT-002 M19/7 addendum's bill, paid where somebody can see it
 * before they press (values are copied, never moved).
 *
 * **Only the gaps are boxes.** The create dialog's rule: creation grows
 * the fields the picked type hard-requires and nothing else, because
 * everything optional is set inline on the record afterwards (DES-017,
 * CTR-016/MTR-014). A carried value therefore has no box — it is stated,
 * not re-typed, which is what "nothing is re-keyed" means.
 *
 * **Cancelling leaves the Request untouched**, and **a lost race ends
 * the dialog in a statement** — both the scaffold's, unchanged from
 * Decline (DES-058 clause 5). Convert's statement names the record the
 * winner made when the seam gave one, because "somebody converted this"
 * without its permanent reference is news a triager cannot act on.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ArrowRightLeft, FilePen, Info } from "lucide-react";
import {
  MAX_CONTRACT_TITLE_LENGTH,
  MAX_MATTER_TITLE_LENGTH,
  type RequestOutcome,
} from "@openlaw/shared";
import {
  contractReference,
  severityLabel,
  SEVERITY_PILL,
  type ContractTypeOption,
} from "../../lib/contracts";
import { matterReference, type MatterTypeOption } from "../../lib/matters";
import {
  isAnswered,
  unansweredRequired,
  toDraft,
  toValue,
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
  | { ok: true }
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
    customFields?: Record<string, CustomFieldValue>;
  }) => Promise<ConvertResult>;
}>) {
  const intl = useIntl();

  /**
   * The contract type the Administrator bound, read live.
   *
   * Only a `contract` target names one: under a Matter target the
   * type id belongs to the matter taxonomy, and the seam reads the
   * contract column for exactly this reason. The API answers `null`
   * for an archived target type, so this is `null` there too — which
   * is how "an archived target type reads as no type" reaches the
   * screen without the screen knowing the rule.
   */
  type TargetModule = "contract" | "matter";
  const initialModule: TargetModule =
    initialTargetModule ?? request.requestType.targetModule ?? "contract";
  const [targetModule, setTargetModule] = useState<TargetModule>(initialModule);
  const targetTypes = targetModule === "contract" ? contractTypes : matterTypes;
  const bound =
    request.requestType.targetModule === targetModule ? request.requestType.targetTypeId : null;
  const confirmed = targetTypes.find((option) => option.id === bound) ?? null;

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
  const initialMatterTemplates =
    request.requestType.targetModule === "matter"
      ? (matterTypes.find((option) => option.id === request.requestType.targetTypeId)?.templates ??
        [])
      : [];
  const [templateId, setTemplateId] = useState(
    initialMatterTemplates.length === 1 ? initialMatterTemplates[0]!.id : "",
  );
  const [title, setTitle] = useState(request.summary);
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

  const target = confirmed ?? targetTypes.find((option) => option.id === pickedId) ?? null;
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

  /** What the form already answered that the target type also attaches:
   * the values conversion carries, stated rather than re-typed. */
  const archivedCarries = targetFields.filter(
    (field) =>
      isAnswered(request.customFields[field.slug]) &&
      isArchivedCustomFieldReference(field, request.customFields[field.slug]!, customFieldRefs),
  );
  const archivedCarrySlugs = new Set(archivedCarries.map((field) => field.slug));
  const carries = targetFields.filter(
    (field) => isAnswered(request.customFields[field.slug]) && !archivedCarrySlugs.has(field.slug),
  );
  /** Whether the two lists below can be drawn at all. Until a target
   * type is picked there is nothing to compare a collected value
   * against, and a list that claimed every value was staying behind
   * would be answering a question nobody has asked yet. */
  const knowsTarget = target !== null;
  /** What the form answered that has nowhere to land (the INT-002 M19/7
   * addendum). Named by the box that collected it, because that is what
   * the requester filled in. */
  const staysBehind = fields.filter(
    (field) =>
      isAnswered(request.customFields[field.slug]) &&
      !targetFields.some((attached) => attached.slug === field.slug),
  );
  /** The fields the target type demands that no collected value answers
   * — the gaps that need creation boxes beside the title. */
  const gaps = unansweredRequired(targetFields, request.customFields);
  const gapSlugs = new Set(gaps.map((field) => field.slug));
  /** Creation boxes, in the target type's order. A missing required
   * value and an archived carry use the same control for two reasons
   * (#437); the latter is the only answered value triage may replace. */
  const repairs = targetFields.filter(
    (field) => gapSlugs.has(field.slug) || archivedCarrySlugs.has(field.slug),
  );
  /** Re-target: this Request's front door promised something other than
   * a contract, or promised nothing at all (DD-018 rule 5). */
  const reTargeting = request.requestType.targetModule !== targetModule;

  async function submit() {
    if (busy) return;
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
    const customFields: Record<string, CustomFieldValue> = {};
    for (const field of repairs) {
      const parsed = toValue(
        field,
        drafts[field.slug] ?? toDraft(field, selectedTemplate?.defaultCustomFields[field.slug]),
      );
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
      if (parsed.value === null) {
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
      customFields[field.slug] = parsed.value;
    }

    const result = await onConvert({
      title: named,
      // Sent only where the request type deferred it. Where it named a
      // live type, the seam reads its own configuration and a body that
      // repeated it would be the client asserting the routing.
      ...(confirmed === null
        ? targetModule === "contract"
          ? { contractTypeId: target.id }
          : { matterTypeId: target.id }
        : {}),
      ...(selectedTemplate ? { templateId: selectedTemplate.id } : {}),
      ...(Object.keys(customFields).length === 0 ? {} : { customFields }),
    });
    if (result.ok) return;
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="convert.title"
            defaultMessage="Convert {reference} to a {module, select, matter {matter} other {contract}}"
            values={{ reference, module: targetModule }}
          />
        </DialogTitle>
        {alreadyDecided ? (
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
            {/* I3's information callout, whole. It is the promise the
                whole milestone is for. */}
            <p className="flex items-start gap-1.5 rounded-card bg-status-info-bg px-2.5 py-2 text-xs text-status-info-fg">
              <Info size={16} aria-hidden="true" className="mt-px shrink-0" />
              <FormattedMessage
                id="convert.carryNote"
                defaultMessage="Form responses carry into the {module, select, matter {matter} other {contract}} — nothing is re-keyed."
                values={{ module: targetModule }}
              />
            </p>
            {reTargeting && (
              // DD-018 rule 5, said out loud. A Request that promised a
              // matter or promised nothing can still become a contract,
              // and the Request survives either way.
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <ArrowRightLeft size={16} aria-hidden="true" className="mt-px shrink-0" />
                <FormattedMessage
                  id="convert.retarget"
                  defaultMessage="This request type does not target a {module, select, matter {matter} other {contract}}. Converting it to one is a re-target, and the request itself is kept."
                  values={{ module: targetModule }}
                />
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-title">
                <FormattedMessage id="convert.titleField" defaultMessage="Title" />
                <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                  *
                </span>
                <span className="sr-only">
                  <FormattedMessage id="intake.field.requiredMark" defaultMessage="(required)" />
                </span>
              </Label>
              <Input
                id="convert-title"
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
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="convert.titleNote"
                  defaultMessage="Taken from the request's summary. Edit it before you convert."
                />
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              {confirmed ? (
                <>
                  {/* Stated, not offered — so there is no control here
                      and therefore no label. The Administrator bound the
                      routing when they configured the request type, and
                      triage confirms rather than classifies (DD-018). */}
                  <p className="text-sm font-medium text-primary">
                    <FormattedMessage
                      id="convert.typeField"
                      defaultMessage="{module, select, matter {Matter} other {Contract}} type"
                      values={{ module: targetModule }}
                    />
                  </p>
                  <p className="text-base">{confirmed.displayName}</p>
                  <p className="text-xs text-muted">
                    <FormattedMessage
                      id="convert.typeConfirmed"
                      defaultMessage="Set by the request type. Triage confirms the routing rather than choosing it."
                    />
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="convert-type">
                    <FormattedMessage
                      id="convert.typeField"
                      defaultMessage="{module, select, matter {Matter} other {Contract}} type"
                      values={{ module: targetModule }}
                    />
                    <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                      *
                    </span>
                    <span className="sr-only">
                      <FormattedMessage
                        id="intake.field.requiredMark"
                        defaultMessage="(required)"
                      />
                    </span>
                  </Label>
                  <select
                    id="convert-type"
                    value={pickedId}
                    className={CONTROL_CLASS}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setPickedIds((current) => ({
                        ...current,
                        [targetModule]: nextId,
                      }));
                      if (targetModule === "matter") {
                        const nextType = matterTypes.find((option) => option.id === nextId);
                        const onlyTemplate =
                          nextType?.templates?.length === 1 ? nextType.templates[0] : undefined;
                        if (nextType && onlyTemplate) seedTemplate(nextType, onlyTemplate.id);
                        else if (nextType && templateId) seedTemplate(nextType, "");
                        else setTemplateId("");
                      }
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
                  <p className="text-xs text-muted">
                    <FormattedMessage
                      id="convert.typeDeferred"
                      defaultMessage="This request type left the {module, select, matter {matter} other {contract}} type to conversion."
                      values={{ module: targetModule }}
                    />
                  </p>
                </>
              )}
            </div>
            {matterTarget && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-template">
                  <FormattedMessage
                    id="matters.field.template"
                    defaultMessage="Template (optional)"
                  />
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
                {selectedTemplate && (
                  <p className="text-xs text-muted">
                    <FormattedMessage
                      id="matters.template.contentHint"
                      defaultMessage="Template adds {taskCount, plural, one {# task} other {# tasks}} and {keyDateCount, plural, one {# key date} other {# key dates}}."
                      values={{
                        taskCount: selectedTemplate.taskCount,
                        keyDateCount: selectedTemplate.keyDateCount,
                      }}
                    />
                  </p>
                )}
              </div>
            )}
            {/* MTR-012's 1:1 map, stated rather than offered: urgency is
                what the requester claimed and priority is what legal now
                holds. Risk is not here at all — it is never
                requester-set, and it is set on the record. */}
            <div className="flex flex-col gap-1.5">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-primary">
                <FormattedMessage id="convert.priority" defaultMessage="Priority" />
                <span
                  className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${SEVERITY_PILL[request.urgency]}`}
                >
                  {severityLabel(intl, request.urgency)}
                </span>
              </p>
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="convert.priorityNote"
                  defaultMessage="Taken from the urgency the requester gave. Risk stays yours to set on the record."
                />
              </p>
            </div>
            {knowsTarget && carries.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">
                  <FormattedMessage
                    id="convert.carries"
                    defaultMessage="Carries into the {module, select, matter {matter} other {contract}}"
                    values={{ module: targetModule }}
                  />
                </p>
                <dl className="flex flex-col gap-1">
                  {carries.map((field) => (
                    <div key={field.slug} className="flex flex-wrap gap-x-2 text-xs">
                      <dt className="text-muted">{field.displayName}</dt>
                      <dd className="min-w-0 break-words">
                        {customFieldValueText(
                          intl,
                          field,
                          request.customFields[field.slug]!,
                          customFieldRefs,
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {knowsTarget && staysBehind.length > 0 && (
              // Named, never silent (the INT-002 M19/7 addendum). The
              // value is not deleted and the Request goes on showing it,
              // which is what the second sentence says.
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
                <p className="text-xs text-muted">
                  <FormattedMessage
                    id="convert.staysBehindNote"
                    defaultMessage="This {module, select, matter {matter} other {contract}} type has no field for these. Nothing is deleted, and they stay on the request where you can still read them."
                    values={{ module: targetModule }}
                  />
                </p>
              </div>
            )}
            {/* The target type's hard-required fields, grown into the
                dialog the moment there is a target (CTR-016/MTR-014). A
                record cannot be born missing what its type demands, and
                this is where somebody can answer it. An archived carry
                draws the same box (#437): the seam refuses the dead id,
                so a live replacement is work Convert needs too. */}
            {repairs.map((field) => (
              <div key={field.slug} className="flex flex-col gap-1.5">
                <Label id={`convert-${field.slug}-label`} htmlFor={`convert-${field.slug}`}>
                  {field.displayName}
                  <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                    *
                  </span>
                  <span className="sr-only">
                    <FormattedMessage id="intake.field.requiredMark" defaultMessage="(required)" />
                  </span>
                </Label>
                <CustomFieldControl
                  id={`convert-${field.slug}`}
                  field={field}
                  draft={
                    drafts[field.slug] ??
                    toDraft(field, selectedTemplate?.defaultCustomFields[field.slug])
                  }
                  people={people}
                  entities={entities}
                  required
                  describedBy={`convert-${field.slug}-help`}
                  onDraft={(next) => {
                    setDrafts((current) => ({ ...current, [field.slug]: next }));
                    setError(null);
                  }}
                />
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
                    (field.description ?? (
                      <FormattedMessage
                        id="convert.gapNote"
                        defaultMessage="Required on this {module, select, matter {matter} other {contract}} type. The form did not collect it."
                        values={{ module: targetModule }}
                      />
                    ))
                  )}
                </p>
              </div>
            ))}
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
                <Button type="button" variant="secondary" onClick={onClose}>
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
