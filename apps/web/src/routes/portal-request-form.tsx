// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal submission form (INT-001, INT-002, #378), from the I6
 * frame of intake.pen: one request type's form, and the confirmation a
 * submission earns.
 *
 * Default and attached fields share the request type's saved presentation
 * order. Required validation and submission values do not depend on position.
 *
 * **The refusal is shown twice, on purpose.** One alert says what is
 * wrong, and each unanswered field says it again beside the box that
 * answers it — a person filling a form in has to know which box, and a
 * sentence at the top of a long form does not point at one.
 *
 * **An out-of-scope attached field renders like any other.** The
 * INT-002 M19/7 addendum makes "attached but outside the current
 * target's scope" a state that exists; the portal meets it rather than
 * hiding it, so the field is drawn, marked, and collected as the
 * Administrator attached it.
 *
 * ### Recorded normalization points (I6 deviations accepted)
 *
 * 1. I6 draws a per-type lucide glyph beside the form title
 *    (`file-pen`). A request type carries a slug, a name, a
 *    description, an order, and a target (INT-002) — no icon — so the
 *    title is the name alone. It is the I5 picker's normalization,
 *    applied to the same row on the next screen.
 * 2. Default fields stay on every form, but Administrators can move them
 *    alongside attached fields. Unsaved forms retain the original order.
 * 3. I6's Urgency control offers "Normal". DES-018's ramp replaced that
 *    vocabulary, as INT-002 already records: the four levels are low,
 *    medium, high, and critical.
 * 4. I6 pairs two short fields into a hand-built two-up row.
 *    `request_type_fields` carries an order and no width, so attached
 *    fields render one per row whatever their type.
 * 5. I6's side column carries a "What happens next" note promising a
 *    pick-up "within one business day". OpenLaw records no
 *    service-level agreement and nothing in the product decides that
 *    number, so the panel is not drawn. The deflection panel above it
 *    is, because its links are the Administrator's own rows (INT-004).
 * 6. I6's dropzone carries no list of what was picked and no way to
 *    take one back. The files a requester chose are listed under it,
 *    each with a control that removes it, because a mis-picked file
 *    that cannot be unpicked is a form that has to be started again.
 * 7. I6 draws the form as one run of fields. The fixed basics and the
 *    type's own fields sit under two section strips, so a long form
 *    reads as "what every request says" and then "what this kind of
 *    request adds". The second strip is absent when the type attaches
 *    no fields: a heading over nothing is not a section.
 *
 * ### The paper (#380)
 *
 * **The files are picked before Submit and uploaded after it.** An
 * attachment is a row against a Request, so there is no Request to
 * attach to until the submission has been accepted — the form holds the
 * chosen files, posts the Request, and then puts the paper on it one
 * call at a time.
 *
 * **The confirmation appears the moment the Request exists**, not when
 * the last file lands. The ask has arrived and that is true whatever
 * the paper does next; a requester whose browser closed mid-upload must
 * already have been told, and must already have the number to quote.
 *
 * **A file that does not land is named, not swallowed** — with the
 * seam's own reason beside it, because "over the 100 MB upload limit" is
 * something a requester can act on and "did not attach" is not. There is
 * no retry here because there is no upload control on the request detail
 * yet; the honest answer is the fact and the reference to quote.
 */

import {
  IntakeCounterpartiesInput,
  type IntakeCounterpartySelection,
} from "../components/intake/counterparties-input";
import { Field, AttachmentsField } from "../components/intake/form-fields";
import { HelpLink } from "../components/documentation/help-link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { CircleCheck, Mail, TriangleAlert } from "lucide-react";
import { resolveIntakeFieldOrder } from "@openlaw/shared";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { SEVERITY_LEVELS, severityLabel } from "../lib/contracts";
import {
  emptyDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../lib/custom-fields";
import { CONTROL_CLASS } from "../lib/form-controls";
import { problem as readProblem } from "../lib/problem";
import { attachToRequest, requestReference } from "../lib/requests";
import { currentUserFor, useSignOut } from "../lib/session";
import { readPortalEntityOptions } from "../lib/portal-entities";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import { AutoResizeTextarea } from "../components/auto-resize-textarea";
import { PageTitle } from "../components/page-title";
import { PortalBackLink } from "../components/portal/back-link";
import { DeflectionPanel } from "../components/portal/deflection-panel";
import { PortalShell } from "../components/portal/portal-shell";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DepartmentPicker } from "../components/department-picker";

type FormResponse =
  paths["/api/v1/portal/request-types/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];

/** One attached catalog field, as the form draws it. Structurally the
 * contract record's own attached field, because both come from the one
 * `AttachedCustomFieldSchema` the API answers everywhere. */
type FormField = FormResponse["fields"][number];

export async function portalRequestFormLoader({ params, request }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/login");
  const res = await api.GET("/api/v1/portal/request-types/{slug}", {
    params: { path: { slug: params.slug! } },
  });
  // A slug that names nothing, or names an archived type, is not an
  // error a requester can act on: an archived form takes no submissions
  // (the INT-004 addendum), and the picker is where a request type is
  // chosen. So a stale link lands on the home, which offers the types
  // that are open. Only that refusal — anything else went wrong, and a
  // requester sent quietly to the picker would never learn it.
  if (res.response.status === 404) return redirect("/portal");
  if (!res.data) throw new Error("The request form could not be read.");
  const entities = res.data.fields.some((field) => field.fieldType === "entity")
    ? await readPortalEntityOptions()
    : [];
  return { user, ...res.data, entities };
}

const TITLE = defineMessage({
  id: "portal.form.pageTitle",
  defaultMessage: "New request",
});

/** The three basics that carry a value. Attachments are the fourth. */
type BasicKey = "title" | "description" | "urgency";

/** What the confirmation knows: the Request that exists, whether its
 * paper is still going up, and the files that did not make it with the
 * seam's own reason for each. */
interface Submitted {
  number: number;
  uploading: boolean;
  unattached: readonly { filename: string; detail?: string }[];
  /** Set when an attachment raced a disposition. The Request detail is
   * the stable portal address of the thread that takes the paper now. */
  threadNumber: number | null;
}

export function PortalRequestFormPage() {
  const {
    user,
    requestType,
    fields,
    intakeLinks,
    entities,
    departments = [],
  } = useLoaderData<typeof portalRequestFormLoader>();
  const intl = useIntl();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /** DES-018's ramp, and `medium` until the requester says otherwise —
   * the same default a contract's priority is born with. */
  const [urgency, setUrgency] = useState<(typeof SEVERITY_LEVELS)[number]>("medium");
  const [departmentId, setDepartmentId] = useState<string | null>(
    departments.some((department) => department.id === user.departmentId)
      ? user.departmentId
      : null,
  );
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>({});
  /** The paper, chosen but not yet sent: an attachment is a row against
   * a Request, and there is no Request until Submit is pressed. */
  const [counterparties, setCounterparties] = useState<IntakeCounterpartySelection[]>([]);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false);
  /** The refusal, as a sentence and as a set of boxes. Both come from
   * the same press, so they can never disagree. */
  const [error, setError] = useState<string | null>(null);
  const [unanswered, setUnanswered] = useState<ReadonlySet<string>>(new Set());
  /** Set by the 201, before the paper follows. It replaces the form,
   * because the Request now exists and the boxes are no longer a thing
   * to press — a requester whose browser closed while the files were
   * still going up must have been told the ask landed. */
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const signOut = useSignOut("/portal/login");

  /** A key stops being marked the moment it is answered, so a refusal
   * clears box by box rather than only on the next press. */
  function clearMark(key: BasicKey | string) {
    setUnanswered((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  async function submit() {
    if (busy) return;
    setError(null);

    // The seam refuses an incomplete form too, and names the same
    // fields. This runs first so the marks land on the boxes: the
    // refusal sentence names fields, and a sentence cannot point.
    const missing: string[] = [];
    const marks = new Set<string>();
    if (title.trim() === "") {
      missing.push(intl.formatMessage(BASIC_LABELS.title));
      marks.add("title");
    }
    if (description.trim() === "") {
      missing.push(intl.formatMessage(BASIC_LABELS.description));
      marks.add("description");
    }

    if (departments.length > 0 && !departmentId) {
      missing.push(intl.formatMessage({ id: "records.department", defaultMessage: "Department" }));
      marks.add("department");
    }

    const customFields: Record<string, CustomFieldValue> = {};
    for (const field of fields) {
      const parsed = toValue(field, drafts[field.slug] ?? emptyDraft(field));
      if ("error" in parsed) {
        setError(
          intl.formatMessage(
            {
              id: "portal.form.numberInvalid",
              defaultMessage: "{fieldName}: enter this as a number.",
            },
            { fieldName: field.displayName },
          ),
        );
        setUnanswered(new Set([field.slug]));
        return;
      }
      if (parsed.value === null) {
        if (field.isRequired) {
          missing.push(field.displayName);
          marks.add(field.slug);
        }
        continue;
      }
      customFields[field.slug] = parsed.value;
    }

    if (missing.length > 0) {
      setUnanswered(marks);
      setError(
        intl.formatMessage(
          {
            id: "portal.form.missingRequired",
            defaultMessage:
              "Fill {fields} first — " +
              "{count, plural, one {the form requires it} other {the form requires them}}.",
          },
          { count: missing.length, fields: intl.formatList(missing, { type: "conjunction" }) },
        ),
      );
      return;
    }
    setUnanswered(new Set());

    setBusy(true);
    const result = await api
      .POST("/api/v1/requests", {
        body: {
          requestTypeId: requestType.id,
          departmentId,
          title: title.trim(),
          description: description.trim(),
          urgency,
          customFields,
          ...(fields.some((field) => field.builtInKey === "counterparties")
            ? { counterparties: counterparties.map((selection) => selection.pick) }
            : {}),
        },
      })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (!data) {
      setBusy(false);
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "portal.form.submitError",
            defaultMessage: "The request could not be submitted.",
          }),
      );
      return;
    }

    // The Request exists from here on, so the confirmation is shown at
    // once rather than held back behind the uploads: the ask landed,
    // and that is true whatever the paper does next. The files follow
    // one at a time — the seam takes one per call — and each that does
    // not land is named on the confirmation as it settles, with the
    // seam's own reason beside it.
    const number = data.request.number;
    setBusy(false);
    setSubmitted({ number, uploading: files.length > 0, unattached: [], threadNumber: null });
    for (const file of files) {
      const outcome = await attachToRequest(number, file);
      if (outcome.ok) continue;
      setSubmitted((current) =>
        current === null
          ? current
          : {
              ...current,
              unattached: [...current.unattached, { filename: file.name, detail: outcome.detail }],
              threadNumber: outcome.thread?.requestNumber ?? current.threadNumber,
            },
      );
    }
    setSubmitted((current) => (current === null ? current : { ...current, uploading: false }));
  }

  const fieldOrder = resolveIntakeFieldOrder(
    fields.map((field) => field.fieldId),
    requestType.formFieldOrder,
  );
  const formControls: Record<string, ReactNode> = {
    "basic:title": (
      <Field
        htmlFor="request-title"
        label={intl.formatMessage(BASIC_LABELS.title)}
        required
        unanswered={unanswered.has("title")}
      >
        <Input
          id="request-title"
          value={title}
          aria-required="true"
          aria-invalid={unanswered.has("title") || undefined}
          placeholder={intl.formatMessage({
            id: "portal.form.summaryHint",
            defaultMessage: "Enter a descriptive title for your request",
          })}
          onChange={(event) => {
            setTitle(event.target.value);
            clearMark("title");
          }}
        />
      </Field>
    ),
    "basic:description": (
      <Field
        htmlFor="request-description"
        label={intl.formatMessage(BASIC_LABELS.description)}
        required
        unanswered={unanswered.has("description")}
      >
        <AutoResizeTextarea
          id="request-description"
          rows={4}
          value={description}
          aria-required="true"
          aria-invalid={unanswered.has("description") || undefined}
          placeholder={intl.formatMessage({
            id: "portal.form.descriptionHint",
            defaultMessage:
              "What is it, who is on the other side, and what do you need from Legal?",
          })}
          onChange={(event) => {
            setDescription(event.target.value);
            clearMark("description");
          }}
        />
      </Field>
    ),
    "basic:department": (
      <Field
        htmlFor="request-department"
        required={departments.length > 0}
        unanswered={unanswered.has("department")}
        label={intl.formatMessage({
          id: "records.department",
          defaultMessage: "Department",
        })}
      >
        <DepartmentPicker
          id="request-department"
          required={departments.length > 0}
          invalid={unanswered.has("department")}
          value={departmentId}
          options={departments}
          onChange={(value) => {
            setDepartmentId(value);
            clearMark("department");
          }}
          disabled={busy || departments.length === 0}
        />
        {departments.length === 0 && (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="portal.form.noDepartments"
              defaultMessage="No Departments are configured. You can submit without one; an Administrator can add Departments in Settings."
            />
          </p>
        )}
      </Field>
    ),
    "basic:urgency": (
      <Field htmlFor="request-urgency" label={intl.formatMessage(BASIC_LABELS.urgency)} required>
        <select
          id="request-urgency"
          value={urgency}
          className={CONTROL_CLASS}
          aria-required="true"
          // Read back off the ramp rather than asserted onto
          // it: the four options are the only ones the select
          // draws, and this is what makes that a fact rather
          // than a promise the compiler was told to believe.
          onChange={(event) => {
            const picked = SEVERITY_LEVELS.find((level) => level === event.target.value);
            if (picked) setUrgency(picked);
          }}
        >
          {SEVERITY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {severityLabel(intl, level)}
            </option>
          ))}
        </select>
      </Field>
    ),
    "basic:attachments": <AttachmentsField files={files} onFiles={setFiles} />,
    ...Object.fromEntries(
      fields.map((field) => [
        field.fieldId,
        <AttachedField
          key={field.slug}
          field={field}
          entities={entities}
          requestTypeId={requestType.id}
          counterparties={counterparties}
          onCounterparties={setCounterparties}
          draft={drafts[field.slug] ?? emptyDraft(field)}
          unanswered={unanswered.has(field.slug)}
          onDraft={(next) => {
            setDrafts((current) => ({ ...current, [field.slug]: next }));
            clearMark(field.slug);
          }}
        />,
      ]),
    ),
  };

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(TITLE)} />
      <PortalBackLink>
        <FormattedMessage id="portal.form.back" defaultMessage="All request types" />
      </PortalBackLink>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold">{requestType.displayName}</h1>
        {requestType.description !== null && (
          <p className="max-w-prose text-md text-muted">{requestType.description}</p>
        )}
      </div>
      <HelpLink surface="portal" contextual />
      <div className="grid gap-section-gap @3xl/page:grid-cols-portal-split">
        <div className="min-w-0">
          {submitted ? (
            <Confirmation {...submitted} />
          ) : (
            <form
              noValidate
              className="flex flex-col overflow-hidden rounded-card border border-border-default bg-raised"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
                <h2 className="text-base font-semibold">
                  <FormattedMessage
                    id="portal.form.basicsHeading"
                    defaultMessage="About your request"
                  />
                </h2>
              </div>
              <div className="flex flex-col gap-5 p-4">
                {fieldOrder.map((key) => (
                  <Fragment key={key}>{formControls[key]}</Fragment>
                ))}
              </div>
              {error && (
                <p role="alert" className="px-4 pb-4 text-sm text-status-danger-fg">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default bg-section-header px-4 py-3">
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <Mail aria-hidden="true" className="size-4 shrink-0" />
                  <FormattedMessage
                    id="portal.form.footerNote"
                    defaultMessage="You'll get email updates and can track progress here."
                  />
                </span>
                <Button type="submit" disabled={busy}>
                  <FormattedMessage id="portal.form.submit" defaultMessage="Submit request" />
                </Button>
              </div>
            </form>
          )}
        </div>
        {/* This request type's own deflection links (INT-004): a
            type-specific answer can still deflect at the last moment.
            The panel draws nothing when the type has none. */}
        <aside className="flex flex-col gap-4 @3xl/page:self-start">
          <DeflectionPanel links={intakeLinks} />
        </aside>
      </div>
    </PortalShell>
  );
}

/** The fixed basics' labels, said once: the form draws them and the
 * refusal names them, and two spellings would be two fields. */
const BASIC_LABELS = {
  title: defineMessage({ id: "portal.form.title", defaultMessage: "Title" }),
  description: defineMessage({ id: "portal.form.description", defaultMessage: "Description" }),
  attachments: defineMessage({ id: "portal.form.attachments", defaultMessage: "Attachments" }),
  urgency: defineMessage({ id: "portal.form.urgency", defaultMessage: "Urgency" }),
} as const;

/** One form row: the label with its required mark, the control, and the
 * two lines that may sit under it — the field's help text and the
 * refusal this box earned. */
/** Entity Fields use ENT-010's list; person Fields still have no Portal choices. */
function AttachedField({
  field,
  entities,
  draft,
  unanswered,
  onDraft,
  requestTypeId,
  counterparties,
  onCounterparties,
}: Readonly<{
  requestTypeId: string;
  counterparties: readonly IntakeCounterpartySelection[];
  onCounterparties: (value: IntakeCounterpartySelection[]) => void;
  field: FormField;
  entities: readonly FieldReference[];
  draft: CustomFieldDraft;
  unanswered: boolean;
  onDraft: (draft: CustomFieldDraft) => void;
}>) {
  const controlId = `request-field-${field.slug}`;
  return (
    <Field
      htmlFor={controlId}
      label={field.displayName}
      required={field.isRequired}
      hint={field.description ?? undefined}
      hintId={`${controlId}-help`}
      unanswered={unanswered}
    >
      {field.builtInKey === "counterparties" ? (
        <IntakeCounterpartiesInput
          required={field.isRequired}
          id={controlId}
          requestTypeId={requestTypeId}
          selections={counterparties}
          invalid={unanswered}
          describedBy={field.description ? `${controlId}-help` : undefined}
          onChange={(next) => {
            onCounterparties(next);
            onDraft(next.map((selection) => selection.label).join("\n"));
          }}
        />
      ) : (
        <CustomFieldControl
          id={controlId}
          field={field}
          entities={entities}
          draft={draft}
          required={field.isRequired}
          invalid={unanswered}
          describedBy={field.description ? `${controlId}-help` : undefined}
          onDraft={onDraft}
        />
      )}
    </Field>
  );
}

/**
 * What a submission earns: the R-### number, which is the handle a
 * requester refers to the ask by (INT-002).
 *
 * A file that did not attach is named here rather than swallowed. The
 * Request landed and that is the first thing this says; the paper that
 * did not follow it is the second, because a requester who thinks Legal
 * is holding a document it never received is worse off than one who is
 * told.
 */
function Confirmation({ number, uploading, unattached, threadNumber }: Readonly<Submitted>) {
  const intl = useIntl();
  const heading = useRef<HTMLHeadingElement>(null);
  // The form it replaced held the focus, and a region that appears
  // where focus used to be is a region a screen reader may never
  // reach. Moving focus to the heading announces the whole panel and
  // puts the reader at the top of what is now the only thing on the
  // screen — the pattern DES-011 asks for on a surface that swaps out
  // from under the keyboard.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border-default bg-raised p-6">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-avatar bg-status-success-bg text-status-success-fg"
      >
        <CircleCheck className="size-6" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 ref={heading} tabIndex={-1} className="rounded-chip text-lg font-semibold">
          <FormattedMessage
            id="portal.form.confirmationHeading"
            defaultMessage="Thanks! Your request has been submitted to legal."
          />
        </h2>
        <p className="max-w-prose text-md text-muted">
          <FormattedMessage
            id="portal.form.confirmationBody"
            defaultMessage="You can track your open requests through this portal"
          />
        </p>
      </div>
      {uploading && (
        <p className="text-sm text-muted">
          <FormattedMessage
            id="portal.form.attachmentsUploading"
            defaultMessage="Attaching your files…"
          />
        </p>
      )}
      {unattached.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-card bg-status-warning-bg px-3 py-2.5 text-sm text-status-warning-fg"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">
              {threadNumber === null ? (
                <FormattedMessage
                  id="portal.form.attachmentsFailed"
                  defaultMessage={
                    "{count, plural, one {This file did not attach.} " +
                    "other {These files did not attach.}} " +
                    "Quote {reference} and send {count, plural, one {it} other {them}} " +
                    "to Legal another way."
                  }
                  values={{ count: unattached.length, reference: requestReference(intl, number) }}
                />
              ) : (
                <FormattedMessage
                  id="portal.form.attachmentsMovedToThread"
                  defaultMessage={
                    "{count, plural, one {This file did not attach.} " +
                    "other {These files did not attach.}} " +
                    "<thread>Add {count, plural, one {it} other {them}} to a reply on {reference}</thread>."
                  }
                  values={{
                    count: unattached.length,
                    reference: requestReference(intl, threadNumber),
                    thread: (chunks) => (
                      <Link
                        to={`/portal/requests/${String(threadNumber)}#portal-request-composer`}
                        className="font-medium text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                      >
                        {chunks}
                      </Link>
                    ),
                  }}
                />
              )}
            </p>
            <ul className="flex flex-col gap-0.5">
              {unattached.map((file, index) => (
                // Two files may carry one name, as the picker records,
                // so the position in the list identifies a row here.
                <li key={`${String(index)}-${file.filename}`} className="break-words">
                  {file.detail === undefined ? (
                    file.filename
                  ) : (
                    <FormattedMessage
                      id="portal.form.attachmentFailedReason"
                      defaultMessage="{filename} — {reason}"
                      values={{ filename: file.filename, reason: file.detail }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link to={`/portal/requests/${String(number)}`}>
            <FormattedMessage id="portal.form.confirmationOpen" defaultMessage="Open request" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/portal">
            <FormattedMessage
              id="portal.form.confirmationBack"
              defaultMessage="Back to the portal"
            />
          </Link>
        </Button>
      </div>
    </section>
  );
}
