// SPDX-License-Identifier: AGPL-3.0-only

/** Prefilled conversion form. Edits apply to the new record when conversion succeeds. */

import { CreateAttachments, useCreateAttachments } from "../documents/create-attachments";
import { ConversionEvidence } from "./conversion-evidence";
import { DescriptionSourceToggle, RequesterDescription } from "./description-source-toggle";
import type { ConversionDraft } from "./prepared-convert-dialog";
import { api } from "../../lib/api";
import { AiField } from "../ui/ai-field";
import { useEffect, useRef, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { ArrowRightLeft, FilePen } from "lucide-react";
import {
  INTAKE_CARRY_SLUGS,
  sameConversionValue,
  MAX_CONTRACT_TITLE_LENGTH,
  MAX_COUNTERPARTY_NAME_LENGTH,
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
  ConvertRequestInput,
  StaffRequest,
  StaffRequestField,
  StaffRequestFieldRefs,
} from "../../lib/requests";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { AutoResizeTextarea } from "../auto-resize-textarea";
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

const sourceStatusMessages = defineMessages({
  readable: { id: "conversion.sourceStatus.readable", defaultMessage: "readable" },
  unreadable: { id: "conversion.sourceStatus.unreadable", defaultMessage: "unreadable" },
  unsupported: { id: "conversion.sourceStatus.unsupported", defaultMessage: "unsupported" },
  truncated: { id: "conversion.sourceStatus.truncated", defaultMessage: "truncated" },
  omitted: { id: "conversion.sourceStatus.omitted", defaultMessage: "omitted" },
});
const sourceReasonMessages = defineMessages({
  source_limit: { id: "conversion.sourceReason.sourceLimit", defaultMessage: "attachment limit" },
  byte_limit: { id: "conversion.sourceReason.byteLimit", defaultMessage: "file size limit" },
  character_limit: { id: "conversion.sourceReason.characterLimit", defaultMessage: "text limit" },
  runtime_limit: {
    id: "conversion.sourceReason.runtimeLimit",
    defaultMessage: "reading time limit",
  },
  restricted: { id: "conversion.sourceReason.restricted", defaultMessage: "restricted source" },
  other: { id: "conversion.sourceReason.other", defaultMessage: "reading limit" },
});
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
  initialDraft: suppliedDraft,
  preparationSettings,
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
  initialDraft?: ConversionDraft;
  preparationSettings?: { matter: boolean; contract: boolean };
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
  onConvert: (input: ConvertRequestInput) => Promise<ConvertResult>;
}>) {
  const intl = useIntl();
  const attachments = useCreateAttachments();
  const [initialDraft, setInitialDraft] = useState(suppliedDraft);
  const suggestions = initialDraft?.suggestions ?? {};
  const pendingRead = useRef<AbortController | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparationFailed, setPreparationFailed] = useState(false);
  useEffect(() => () => pendingRead.current?.abort(), []);
  const [human, setHuman] = useState<Set<string>>(new Set());
  const [dropped, setDropped] = useState(false);
  const humanRef = useRef(human);
  const humanValue = (slug: string) => {
    humanRef.current = new Set([...humanRef.current, slug]);
    setHuman(humanRef.current);
  };
  const suggested = (slug: string) => (dropped ? undefined : suggestions[slug]);
  function carriedValue(slug: string): unknown {
    if (slug.startsWith("field:")) return request.customFields[slug.slice(6)];
    const values: Record<string, unknown> = {
      title: request.title,
      description: request.description,
      priority: request.urgency,
      counterparty: collectedText(fields, request, INTAKE_CARRY_SLUGS.counterpartyName),
      needed_by: collectedText(fields, request, INTAKE_CARRY_SLUGS.neededBy),
      [`${request.requestType.targetModule}_type`]: request.requestType.targetTypeId,
    };
    return values[slug];
  }
  const marked = (slug: string) =>
    Boolean(suggested(slug)) &&
    !human.has(slug) &&
    !sameConversionValue(suggested(slug)?.value, carriedValue(slug));
  const unreadAttachments =
    initialDraft?.attachmentReads.filter((source) => source.status !== "readable") ?? [];
  /** What the evidence panel head calls the value. */
  const valueLabel = (slug: string) =>
    slug.startsWith("field:")
      ? targetFields.find((field) => `field:${field.slug}` === slug)?.displayName
      : intl.formatMessage(
          {
            id: "conversion.targetLabel",
            defaultMessage:
              "{slug, select, title {Title} description {Description} matter_type {Matter type} contract_type {Contract type} counterparty {Counterparty} priority {Priority} needed_by {Needed by} other {Value}}",
          },
          { slug },
        );
  const marker = (slug: string) =>
    marked(slug) && (
      <ConversionEvidence
        number={request.number}
        draftId={initialDraft!.id}
        slug={slug}
        label={valueLabel(slug)}
        onConfirm={async () => {
          humanValue(slug);
          if (slug.startsWith("field:")) {
            const field = targetFields.find((field) => `field:${field.slug}` === slug);
            if (field) setDrafts((current) => ({ ...current, [field.slug]: fieldDraft(field) }));
          }
          return undefined;
        }}
      />
    );
  const [showRequesterDescription, setShowRequesterDescription] = useState(false);
  const [description, setDescription] = useState(
    String(suggestions.description?.value ?? request.description ?? ""),
  );

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
      typeof suggestions.contract_type?.value === "string"
        ? suggestions.contract_type.value
        : (initialModule === "contract" ? initialDraft?.targetTypeId : undefined) ||
          (request.requestType.targetModule === "contract"
            ? (request.requestType.targetTypeId ?? "")
            : ""),
    matter:
      typeof suggestions.matter_type?.value === "string"
        ? suggestions.matter_type.value
        : (initialModule === "matter" ? initialDraft?.targetTypeId : undefined) ||
          (request.requestType.targetModule === "matter"
            ? (request.requestType.targetTypeId ?? "")
            : ""),
  });
  const pickedId = pickedIds[targetModule];
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState(String(suggestions.title?.value ?? request.title));
  const [priority, setPriority] = useState<StaffRequest["urgency"]>(
    SEVERITY_LEVELS.find((level) => level === suggestions.priority?.value) ?? request.urgency,
  );
  /** The two facts that are not Fields on the record (INT-002's
   * 2026-09-09 addendum). Seeded once from the seeded request fields,
   * where the form collected them; editable either way. */
  const [counterpartyName, setCounterpartyName] = useState(() =>
    String(
      suggestions.counterparty?.value ??
        collectedText(fields, request, INTAKE_CARRY_SLUGS.counterpartyName),
    ),
  );
  const [neededBy, setNeededBy] = useState(() =>
    String(
      suggestions.needed_by?.value ?? collectedText(fields, request, INTAKE_CARRY_SLUGS.neededBy),
    ),
  );
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

  /** Puts the boxes a Conversion draft prefilled back to what the manual
   * dialog would have shown, and stops applying the draft. Boxes somebody
   * already edited keep their edit. */
  function dropPreparedValues() {
    setShowRequesterDescription(false);
    pendingRead.current?.abort();
    setPreparing(false);
    setPreparationFailed(false);
    for (const slug of Object.keys(suggestions)) {
      if (human.has(slug)) {
        // A confirmed Field has no text edit in drafts yet, but is human-reviewed.
        if (slug.startsWith("field:") && drafts[slug.slice(6)] === undefined) {
          const field = targetFields.find((field) => `field:${field.slug}` === slug);
          if (field)
            setDrafts((current) => ({
              ...current,
              [field.slug]: toDraft(field, suggestions[slug]!.value),
            }));
        }
        continue;
      }
      if (slug === "title") setTitle(request.title);
      else if (slug === "priority") setPriority(request.urgency);
      else if (slug === "description") setDescription(request.description ?? "");
      else if (slug === "needed_by")
        setNeededBy(collectedText(fields, request, INTAKE_CARRY_SLUGS.neededBy));
      else if (slug === "counterparty")
        setCounterpartyName(collectedText(fields, request, INTAKE_CARRY_SLUGS.counterpartyName));
      else if (slug === "matter_type" || slug === "contract_type")
        setPickedIds((current) => ({
          ...current,
          [targetModule]:
            request.requestType.targetModule === targetModule
              ? (request.requestType.targetTypeId ?? "")
              : "",
        }));
    }
    setDropped(true);
  }

  async function refreshPreparation(module: TargetModule, typeId: string, retry = false) {
    dropPreparedValues();
    if (!preparationSettings?.[module]) return;
    if (!humanRef.current.has(`${module}_type`)) typeId = "";
    const controller = new AbortController();
    pendingRead.current = controller;
    setPreparing(true);
    const expire = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      setPreparing(false);
      setPreparationFailed(true);
    };
    let deadlineTimer = setTimeout(expire, 180_000);
    let progressAt: string | undefined;
    const noteProgress = (next: ConversionDraft) => {
      if (next.progressAt && next.progressAt !== progressAt) {
        progressAt = next.progressAt;
        clearTimeout(deadlineTimer);
        deadlineTimer = setTimeout(expire, 180_000);
      }
    };
    const clearDeadline = () => clearTimeout(deadlineTimer);
    controller.signal.addEventListener("abort", clearDeadline, { once: true });
    try {
      const result = await api.POST("/api/v1/requests/{number}/conversion-drafts", {
        params: { path: { number: request.number } },
        body: { targetModule: module, targetTypeId: typeId, retry },
        signal: controller.signal,
      });
      if (!result.data) throw new Error("unavailable");
      let next: ConversionDraft = result.data.draft;
      while (next.state === "pending" && !controller.signal.aborted) {
        noteProgress(next);
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 1200);
          controller.signal.addEventListener("abort", finish, { once: true });
        });
        if (controller.signal.aborted) return;
        const read = await api.GET("/api/v1/requests/{number}/conversion-drafts/{draftId}", {
          params: { path: { number: request.number, draftId: next.id } },
          signal: controller.signal,
        });
        if (!read.data) throw new Error("unavailable");
        next = read.data.draft;
      }
      if (controller.signal.aborted) return;
      if (next.state !== "ready" || next.targetModule !== module || next.targetTypeId !== typeId)
        throw new Error("unavailable");
      setInitialDraft(next);
      setDropped(false);
      const editable = (slug: string) => !humanRef.current.has(slug) && next.suggestions[slug];
      if (editable("title")) setTitle(String(next.suggestions.title!.value));
      if (editable("description")) setDescription(String(next.suggestions.description!.value));
      if (editable("priority"))
        setPriority(
          SEVERITY_LEVELS.find((level) => level === next.suggestions.priority!.value) ??
            request.urgency,
        );
      if (editable("needed_by")) setNeededBy(String(next.suggestions.needed_by!.value));
      if (editable("counterparty"))
        setCounterpartyName(String(next.suggestions.counterparty!.value));
      if (editable(`${module}_type`))
        setPickedIds((current) => ({
          ...current,
          [module]: String(next.suggestions[`${module}_type`]!.value),
        }));
    } catch {
      if (!controller.signal.aborted) setPreparationFailed(true);
    } finally {
      clearDeadline();
      controller.signal.removeEventListener("abort", clearDeadline);
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

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
  /** The slugs this form lands through its own boxes rather than as
   * Fields: a value in one of them is carried, so it is never listed as
   * staying behind. The counterparty box is drawn on the contract arm
   * only. */
  const targetAttaches = (slug: string) => targetFields.some((attached) => attached.slug === slug);
  // A box is drawn only where the target type gives the fact no Field
  // of its own; a type that attaches the slug lands the value once, as
  // that Field, through the ordinary carry.
  const drawsCounterparty =
    targetModule === "contract" && !targetAttaches(INTAKE_CARRY_SLUGS.counterpartyName);
  const drawsNeededBy = !targetAttaches(INTAKE_CARRY_SLUGS.neededBy);
  // A box that holds a value carries it. A box the person cleared does
  // not, and the collected value is then named as staying behind.
  const drawnSlugs = new Set<string>([
    ...(drawsNeededBy && neededBy.trim() !== "" ? [INTAKE_CARRY_SLUGS.neededBy] : []),
    ...(drawsCounterparty && counterpartyName.trim() !== ""
      ? [INTAKE_CARRY_SLUGS.counterpartyName]
      : []),
  ]);
  const staysBehind = fields.filter(
    (field) =>
      isAnswered(request.customFields[field.slug]) &&
      !drawnSlugs.has(field.slug) &&
      !targetAttaches(field.slug),
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
      suggested(`field:${field.slug}`)?.value ??
        request.customFields[field.slug] ??
        selectedTemplate?.defaultCustomFields[field.slug],
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
      if (drafts[field.slug] !== undefined || suggested(`field:${field.slug}`))
        customFields[field.slug] = parsed.value;
    }

    const namedCounterparty = counterpartyName.trim();
    const result = await onConvert({
      title: named,
      ...(initialDraft && (!dropped || human.has("description"))
        ? { description: description.trim() || null }
        : {}),
      ...(initialDraft && !dropped
        ? {
            conversionDraftId: initialDraft.id,
            aiAccepted: Object.keys(suggestions).filter(
              (slug) =>
                marked(slug) &&
                (!slug.startsWith("field:") ||
                  targetFields.some((field) => `field:${field.slug}` === slug)),
            ),
          }
        : {}),
      priority,
      ...(targetModule === "contract"
        ? { contractTypeId: target.id }
        : { matterTypeId: target.id }),
      ...(selectedTemplate ? { templateId: selectedTemplate.id } : {}),
      ...(Object.keys(customFields).length === 0 ? {} : { customFields }),
      // A deliberate clear survives the later Request-context Analysis run.
      ...(drawsCounterparty && human.has("counterparty") && namedCounterparty === ""
        ? { counterpartyCleared: true }
        : {}),
      ...(drawsCounterparty && namedCounterparty !== ""
        ? { counterpartyName: namedCounterparty }
        : {}),
      ...(drawsNeededBy && neededBy !== "" ? { neededBy } : {}),
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
      <DialogContent width="3xl" aria-describedby={undefined}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <DialogTitle className="min-w-0 flex-1">
            <FormattedMessage
              id="convert.title"
              defaultMessage="Convert {reference} to a {module, select, matter {matter} other {contract}}"
              values={{ reference, module: targetModule }}
            />
          </DialogTitle>
          {!attachments.created &&
            !alreadyDecided &&
            ((initialDraft && !dropped) || preparing || preparationFailed) && (
              <Button
                type="button"
                variant="link"
                className="shrink-0"
                disabled={busy}
                onClick={dropPreparedValues}
              >
                <FormattedMessage
                  id="conversion.discardSuggestions"
                  defaultMessage="Discard AI suggestions"
                />
              </Button>
            )}
        </div>
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
            {(preparing || preparationFailed) && (
              <div>
                <p role="status">
                  {preparing ? (
                    <FormattedMessage
                      id="conversion.gettingReady"
                      defaultMessage="Getting {module, select, matter {matter} other {contract}} ready…"
                      values={{ module: targetModule }}
                    />
                  ) : (
                    <FormattedMessage
                      id="conversion.failed"
                      defaultMessage="Preparation could not finish. Retry or continue manually."
                    />
                  )}
                </p>
                {preparationFailed && (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => void refreshPreparation(targetModule, pickedId, true)}
                  >
                    <FormattedMessage id="action.retry" defaultMessage="Retry" />
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-title" required>
                <FormattedMessage id="convert.titleField" defaultMessage="Title" />
              </Label>
              <AiField active={marked("title")} className="flex">
                <Input
                  id="convert-title"
                  aria-required="true"
                  autoFocus
                  value={title}
                  // The seam is what enforces it; the box restates it so
                  // nobody types past a bound they will only meet on the
                  // press. The Decline dialog's rule, applied to a title.
                  maxLength={
                    targetModule === "contract"
                      ? MAX_CONTRACT_TITLE_LENGTH
                      : MAX_MATTER_TITLE_LENGTH
                  }
                  {...(error?.onTitle
                    ? { "aria-invalid": true, "aria-describedby": TITLE_ERROR_ID }
                    : {})}
                  onChange={(event) => {
                    humanValue("title");
                    setTitle(event.target.value);
                    setError(null);
                  }}
                />
              </AiField>
              {marker("title")}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-type" required>
                <FormattedMessage
                  id="convert.typeField"
                  defaultMessage="{module, select, matter {Matter} other {Contract}} type"
                  values={{ module: targetModule }}
                />
              </Label>
              <AiField active={marked(`${targetModule}_type`)} className="flex">
                <select
                  id="convert-type"
                  aria-required="true"
                  value={pickedId}
                  className={CONTROL_CLASS}
                  onChange={(event) => {
                    humanValue(`${targetModule}_type`);
                    const nextId = event.target.value;
                    void refreshPreparation(targetModule, nextId);
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
              </AiField>
              {marker(`${targetModule}_type`)}
            </div>
            {initialDraft && (!dropped || human.has("description")) && (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="convert-description">
                    <FormattedMessage id="matters.field.description" defaultMessage="Description" />
                  </Label>
                  <DescriptionSourceToggle
                    requester={showRequesterDescription}
                    onChange={setShowRequesterDescription}
                    ai={marked("description")}
                  />
                </div>
                {showRequesterDescription ? (
                  <RequesterDescription description={request.description} />
                ) : (
                  <>
                    <AiField active={marked("description")} className="flex">
                      <AutoResizeTextarea
                        id="convert-description"
                        className="min-h-24"
                        value={description}
                        onChange={(event) => {
                          humanValue("description");
                          setDescription(event.target.value);
                        }}
                      />
                    </AiField>
                    {marker("description")}
                  </>
                )}
              </div>
            )}
            {initialDraft &&
              !dropped &&
              initialDraft.warnings.map((warning) => (
                <p key={warning} role="status" className="text-sm text-muted">
                  {warning === "restricted_sources" ? (
                    <FormattedMessage
                      id="conversion.restrictedOmitted"
                      defaultMessage="Restricted messages and Legal or reference Fields were omitted to keep record values safe for broader readers."
                    />
                  ) : warning === "attachment_omissions" ? (
                    <FormattedMessage
                      id="conversion.attachmentOmissions"
                      defaultMessage="Some attachments could not be fully read. Review the source statuses and original files before converting."
                    />
                  ) : warning === "target_budget" ? (
                    <FormattedMessage
                      id="conversion.targetBudgetOmitted"
                      defaultMessage="Some Fields exceeded the preparation limit. Complete them manually."
                    />
                  ) : (
                    <FormattedMessage
                      id="conversion.budgetOmitted"
                      defaultMessage="Some sources exceeded the reading limit and were omitted. Review the original Request too."
                    />
                  )}
                </p>
              ))}
            {/* Only the files that could not be fully read are worth a
                line: they are what the omission warning above points at.
                A list of "readable" files says nothing the reader can act on. */}
            {initialDraft && !dropped && unreadAttachments.length > 0 && (
              <details className="text-sm text-muted">
                <summary>
                  <FormattedMessage
                    id="conversion.attachmentReads"
                    defaultMessage="Attachment reading details"
                  />
                </summary>
                <ul>
                  {unreadAttachments.map((source) => (
                    <li key={source.sourceId}>
                      <FormattedMessage
                        id="conversion.attachmentReadStatus"
                        defaultMessage="{label}: {status}{hasReason, select, yes { — {reason}} other {}}"
                        values={{
                          label: source.label,
                          status: intl.formatMessage(
                            Object.hasOwn(sourceStatusMessages, source.status)
                              ? sourceStatusMessages[source.status]
                              : sourceStatusMessages.omitted,
                          ),
                          hasReason: source.reason ? "yes" : "no",
                          reason: source.reason
                            ? intl.formatMessage(
                                Object.hasOwn(sourceReasonMessages, source.reason)
                                  ? sourceReasonMessages[
                                      source.reason as keyof typeof sourceReasonMessages
                                    ]
                                  : sourceReasonMessages.other,
                              )
                            : "",
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {initialDraft && !dropped && Object.keys(initialDraft.conflicts).length > 0 && (
              <section className="text-sm">
                <FormattedMessage
                  id="conversion.conflicts"
                  defaultMessage="Conflicting sources need your review:"
                />
                {Object.keys(initialDraft.conflicts).map((slug) => (
                  <div key={slug}>
                    {slug.startsWith("field:") ? (
                      (targetTypes
                        .flatMap((type) => type.fields)
                        .find((field) => `field:${field.slug}` === slug)?.displayName ??
                      slug.slice(6))
                    ) : (
                      <FormattedMessage
                        id="conversion.targetLabel"
                        defaultMessage="{slug, select, title {Title} description {Description} matter_type {Matter type} contract_type {Contract type} counterparty {Counterparty} priority {Priority} needed_by {Needed by} other {Value}}"
                        values={{ slug }}
                      />
                    )}
                    <ConversionEvidence
                      number={request.number}
                      draftId={initialDraft.id}
                      slug={slug}
                      label={valueLabel(slug)}
                    />
                  </div>
                ))}
              </section>
            )}
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
              <AiField active={marked("priority")} className="flex">
                <select
                  id="convert-priority"
                  aria-required="true"
                  value={priority}
                  className={CONTROL_CLASS}
                  onChange={(event) => {
                    const value = SEVERITY_LEVELS.find((level) => level === event.target.value);
                    humanValue("priority");
                    if (value) setPriority(value);
                  }}
                >
                  {SEVERITY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {severityLabel(intl, level)}
                    </option>
                  ))}
                </select>
              </AiField>
              {marker("priority")}
            </div>
            {drawsCounterparty && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-counterparty">
                  <FormattedMessage id="convert.counterparty" defaultMessage="Counterparty" />
                </Label>
                <AiField active={marked("counterparty")} className="flex">
                  <Input
                    id="convert-counterparty"
                    value={counterpartyName}
                    maxLength={MAX_COUNTERPARTY_NAME_LENGTH}
                    onChange={(event) => {
                      humanValue("counterparty");
                      setCounterpartyName(event.target.value);
                      setError(null);
                    }}
                  />
                </AiField>
                {marker("counterparty")}
              </div>
            )}
            {drawsNeededBy && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-needed-by">
                  <FormattedMessage id="convert.neededBy" defaultMessage="Needed by" />
                </Label>
                <AiField active={marked("needed_by")} className="flex">
                  <Input
                    id="convert-needed-by"
                    type="date"
                    value={neededBy}
                    onChange={(event) => {
                      humanValue("needed_by");
                      setNeededBy(event.target.value);
                      setError(null);
                    }}
                  />
                </AiField>
                {marker("needed_by")}
              </div>
            )}
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
                <AiField
                  active={marked(`field:${field.slug}`)}
                  className={field.fieldType === "boolean" ? "flex self-start" : "flex"}
                >
                  <CustomFieldControl
                    id={`convert-${field.slug}`}
                    field={field}
                    draft={fieldDraft(field)}
                    people={fieldPeople}
                    entities={fieldEntities}
                    required={field.isRequired}
                    describedBy={
                      archivedCarrySlugs.has(field.slug) ? `convert-${field.slug}-help` : undefined
                    }
                    onDraft={(next) => {
                      humanValue(`field:${field.slug}`);
                      setDrafts((current) => ({ ...current, [field.slug]: next }));
                      setError(null);
                    }}
                  />
                </AiField>
                {archivedCarrySlugs.has(field.slug) && (
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
                    ) : null}
                  </p>
                )}
                {marker(`field:${field.slug}`)}
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
                  const next = targetModule === "contract" ? "matter" : "contract";
                  void refreshPreparation(next, pickedIds[next]);
                  setTargetModule(next);
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
                <Button type="submit" disabled={busy || preparing}>
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

/**
 * The text a request-form field collected under one slug, or the empty
 * string. Only a field the form still names counts: a value under a
 * slug no field carries is a leftover nobody can read the label of.
 */
function collectedText(
  fields: readonly StaffRequestField[],
  request: StaffRequest,
  slug: string,
): string {
  if (!fields.some((field) => field.slug === slug)) return "";
  const value = request.customFields[slug];
  return typeof value === "string" ? value.trim() : "";
}
