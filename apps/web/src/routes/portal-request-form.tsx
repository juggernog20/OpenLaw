// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal submission form (INT-001, INT-002, #378), from the I6
 * frame of intake.pen: one request type's form, and the confirmation a
 * submission earns.
 *
 * **The form is a read, not a second copy of the rule.** The four fixed
 * basics — Summary, Description, Attachments, Urgency — are drawn here
 * because INT-002's M19/4 addendum makes them a fact about every form
 * rather than a configuration of one. Everything after them is the
 * request type's attached catalog fields, in the Administrator's
 * display order, exactly as the API answers them. Nothing on this
 * screen decides what a form collects.
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
 * 2. I6 places Attachments last, under the type's own fields. The four
 *    basics render first, in INT-002's order — Summary, Description,
 *    Attachments, Urgency — which is the order the M19 editor locks
 *    them in. The Administrator reads the form as four basics over the
 *    attached fields, and the requester fills in the same thing.
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

import { useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { ChevronLeft, CircleCheck, FileText, Mail, TriangleAlert, Upload, X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { SEVERITY_LEVELS, severityLabel } from "../lib/contracts";
import {
  emptyDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../lib/custom-fields";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problemDetail } from "../lib/messages";
import { attachToRequest, MAX_REQUEST_ATTACHMENTS, requestReference } from "../lib/requests";
import { currentUser } from "../lib/session";
import { CustomFieldControl } from "../components/custom-field-control";
import { PageTitle } from "../components/page-title";
import { DeflectionPanel } from "../components/portal/deflection-panel";
import { PortalShell } from "../components/portal/portal-shell";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type FormResponse =
  paths["/api/v1/portal/request-types/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];

/** One attached catalog field, as the form draws it. Structurally the
 * contract record's own attached field, because both come from the one
 * `AttachedCustomFieldSchema` the API answers everywhere. */
type FormField = FormResponse["fields"][number];

export async function portalRequestFormLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
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
  return { user, ...res.data };
}

const TITLE = defineMessage({
  id: "portal.form.pageTitle",
  defaultMessage: "New request",
});

/** The Urgency hint's id. Written rather than generated, because the
 * control is one of a kind on this screen and the hint is one line
 * above it. */
const URGENCY_HINT_ID = "request-urgency-help";

/** The three basics that carry a value. Attachments are the fourth. */
type BasicKey = "summary" | "description" | "urgency";

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
  const { user, requestType, fields, intakeLinks } =
    useLoaderData<typeof portalRequestFormLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  /** DES-018's ramp, and `medium` until the requester says otherwise —
   * the same default a contract's priority is born with. */
  const [urgency, setUrgency] = useState<(typeof SEVERITY_LEVELS)[number]>("medium");
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>({});
  /** The paper, chosen but not yet sent: an attachment is a row against
   * a Request, and there is no Request until Submit is pressed. */
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

  async function signOut() {
    await authClient.signOut();
    void navigate("/portal/enter", { replace: true });
  }

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
    if (summary.trim() === "") {
      missing.push(intl.formatMessage(BASIC_LABELS.summary));
      marks.add("summary");
    }
    if (description.trim() === "") {
      missing.push(intl.formatMessage(BASIC_LABELS.description));
      marks.add("description");
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
    const { data, error: problem } = await api
      .POST("/api/v1/requests", {
        body: {
          requestTypeId: requestType.id,
          summary: summary.trim(),
          description: description.trim(),
          urgency,
          customFields,
        },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      setBusy(false);
      setError(
        problemDetail(problem) ??
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

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(TITLE)} />
      <Link
        to="/portal"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
        <FormattedMessage id="portal.form.back" defaultMessage="All request types" />
      </Link>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold">{requestType.displayName}</h1>
        {requestType.description !== null && (
          <p className="text-base text-muted">{requestType.description}</p>
        )}
      </div>
      <div className="@container/form flex flex-col gap-6 @2xl/form:flex-row">
        <div className="min-w-0 flex-1">
          {submitted ? (
            <Confirmation {...submitted} />
          ) : (
            <form
              noValidate
              className="flex flex-col rounded-card border border-border-default bg-raised"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-4 p-4">
                <Field
                  htmlFor="request-summary"
                  label={intl.formatMessage(BASIC_LABELS.summary)}
                  required
                  unanswered={unanswered.has("summary")}
                >
                  <Input
                    id="request-summary"
                    autoFocus
                    value={summary}
                    aria-required="true"
                    aria-invalid={unanswered.has("summary") || undefined}
                    placeholder={intl.formatMessage({
                      id: "portal.form.summaryHint",
                      defaultMessage: "One line — what do you need?",
                    })}
                    onChange={(event) => {
                      setSummary(event.target.value);
                      clearMark("summary");
                    }}
                  />
                </Field>
                <Field
                  htmlFor="request-description"
                  label={intl.formatMessage(BASIC_LABELS.description)}
                  required
                  unanswered={unanswered.has("description")}
                >
                  <textarea
                    id="request-description"
                    rows={4}
                    value={description}
                    className={TEXTAREA_CLASS}
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
                {/* The third basic. Optional on every form (INT-002):
                    a submission with no paper is a complete one. */}
                <AttachmentsField files={files} onFiles={setFiles} />

                <Field
                  htmlFor="request-urgency"
                  label={intl.formatMessage(BASIC_LABELS.urgency)}
                  required
                  hintId={URGENCY_HINT_ID}
                  hint={intl.formatMessage({
                    id: "portal.form.urgencyHint",
                    defaultMessage: "How soon Legal should look at it.",
                  })}
                >
                  <select
                    id="request-urgency"
                    value={urgency}
                    className={CONTROL_CLASS}
                    aria-required="true"
                    aria-describedby={URGENCY_HINT_ID}
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
                {/* The request type's own fields, in the Administrator's
                    display order (INT-002). */}
                {fields.map((field) => (
                  <AttachedField
                    key={field.slug}
                    field={field}
                    draft={drafts[field.slug] ?? emptyDraft(field)}
                    unanswered={unanswered.has(field.slug)}
                    onDraft={(next) => {
                      setDrafts((current) => ({ ...current, [field.slug]: next }));
                      clearMark(field.slug);
                    }}
                  />
                ))}
                {error && (
                  <p role="alert" className="text-sm text-status-danger-fg">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-border-muted px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs text-muted">
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
        <div className="flex flex-col gap-4 @2xl/form:w-70 @2xl/form:shrink-0">
          <DeflectionPanel links={intakeLinks} />
        </div>
      </div>
    </PortalShell>
  );
}

/** The four basics' labels, said once: the form draws them and the
 * refusal names them, and two spellings would be two fields. */
const BASIC_LABELS = {
  summary: defineMessage({ id: "portal.form.summary", defaultMessage: "Summary" }),
  description: defineMessage({ id: "portal.form.description", defaultMessage: "Description" }),
  attachments: defineMessage({ id: "portal.form.attachments", defaultMessage: "Attachments" }),
  urgency: defineMessage({ id: "portal.form.urgency", defaultMessage: "Urgency" }),
} as const;

/** One form row: the label with its required mark, the control, and the
 * two lines that may sit under it — the field's help text and the
 * refusal this box earned. */
function Field({
  htmlFor,
  label,
  required = false,
  hint,
  hintId,
  unanswered = false,
  children,
}: Readonly<{
  htmlFor: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** The help text's own id, so the control can name it. Only the rows
   * whose control carries `aria-describedby` pass one. */
  hintId?: string;
  unanswered?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
              *
            </span>
            <span className="sr-only">
              <FormattedMessage id="portal.form.requiredMark" defaultMessage="(required)" />
            </span>
          </>
        )}
      </Label>
      {children}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {unanswered && (
        <p className="text-xs text-status-danger-fg">
          <FormattedMessage
            id="portal.form.fieldRequired"
            defaultMessage="{field} is required."
            values={{ field: label }}
          />
        </p>
      )}
    </div>
  );
}

/**
 * The Attachments basic: I6's dropzone, the files it has been given, and
 * a way to take one back.
 *
 * The input itself is out of the tab order and out of sight. A keyboard
 * reaches the button beside it, and a second stop on an invisible input
 * is a trap rather than an affordance — the documents composer's rule,
 * applied to the one picker the portal draws. The label still points at
 * the input, so clicking the word opens the picker.
 *
 * Nothing here is marked required and nothing here can refuse: the
 * fourth basic is optional (INT-002), and any file type is accepted
 * because the seam stores whatever a requester is asking Legal about.
 */
function AttachmentsField({
  files,
  onFiles,
}: Readonly<{ files: readonly File[]; onFiles: (files: readonly File[]) => void }>) {
  const intl = useIntl();
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  /** Set when a pick or a drop carried more than there was room for. */
  const [overflowed, setOverflowed] = useState(false);

  function add(chosen: readonly File[]) {
    if (chosen.length === 0) return;
    // The seam refuses a file past the bound, so the picker says so
    // first: a requester who queued thirty files should not learn it
    // ten refusals into a submission. What fits is kept.
    const room = MAX_REQUEST_ATTACHMENTS - files.length;
    setOverflowed(chosen.length > room);
    if (room > 0) onFiles([...files, ...chosen.slice(0, room)]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="request-attachments">
        <FormattedMessage {...BASIC_LABELS.attachments} />
      </Label>
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-button border bg-control px-3 py-4 transition-colors duration-150 ${
          over ? "border-link" : "border-border-default"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add([...event.dataTransfer.files]);
        }}
      >
        <input
          ref={picker}
          id="request-attachments"
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            // Cleared so picking the same file twice in a row still
            // fires a change — the browser answers nothing otherwise,
            // and a requester who removed a file by mistake could not
            // put it back.
            event.target.value = "";
          }}
        />
        <Upload aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <p className="text-center text-sm text-muted">
          <FormattedMessage
            id="portal.form.attachmentsHint"
            defaultMessage="Drop files here — the redline, the prior agreement, the term sheet. Up to {max} files."
            values={{ max: MAX_REQUEST_ATTACHMENTS }}
          />
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => picker.current?.click()}>
          <FormattedMessage id="portal.form.attachmentsBrowse" defaultMessage="Choose files" />
        </Button>
      </div>
      {overflowed && (
        <p role="alert" className="text-xs text-status-danger-fg">
          <FormattedMessage
            id="portal.form.attachmentsTooMany"
            defaultMessage="A request carries at most {max} files."
            values={{ max: MAX_REQUEST_ATTACHMENTS }}
          />
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              // Two files may carry one name — a requester can pick the
              // same paper from two folders — so the position in the
              // list is what identifies a row here.
              key={`${String(index)}-${file.name}`}
              className="flex items-center gap-1.5 text-sm"
            >
              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={intl.formatMessage(REMOVE_ATTACHMENT, { filename: file.name })}
                onClick={() => {
                  setOverflowed(false);
                  onFiles(files.filter((_ignored, at) => at !== index));
                }}
              >
                <X aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">
                  <FormattedMessage {...REMOVE_ATTACHMENT} values={{ filename: file.name }} />
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Said once: the row's accessible name and its tooltip are the same
 * sentence, and two spellings would be two controls. */
const REMOVE_ATTACHMENT = defineMessage({
  id: "portal.form.attachmentRemove",
  defaultMessage: "Remove {filename}",
});

/** One attached catalog field, drawn with the control its type asks
 * for. The `user` and `entity` types offer no rows here: a requester
 * reads neither the staff directory nor the Entity registry, so those
 * two draw an empty picker rather than a leak. */
function AttachedField({
  field,
  draft,
  unanswered,
  onDraft,
}: Readonly<{
  field: FormField;
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
      <CustomFieldControl
        id={controlId}
        field={field}
        draft={draft}
        required={field.isRequired}
        invalid={unanswered}
        describedBy={field.description ? `${controlId}-help` : undefined}
        onDraft={onDraft}
      />
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
    <section className="flex flex-col gap-2 rounded-card border border-border-default bg-raised p-4">
      <h2
        ref={heading}
        tabIndex={-1}
        className="flex items-center gap-1.5 text-md font-semibold text-status-success-fg"
      >
        <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
        <FormattedMessage
          id="portal.form.confirmationHeading"
          defaultMessage="Request {reference} is with Legal"
          values={{ reference: requestReference(intl, number) }}
        />
      </h2>
      <p className="text-base text-muted">
        <FormattedMessage
          id="portal.form.confirmationBody"
          defaultMessage="Quote {reference} when you talk to Legal about it. You'll get updates by email and here in the portal."
          values={{ reference: requestReference(intl, number) }}
        />
      </p>
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
      <Link
        to="/portal"
        className="w-fit text-base font-medium text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        <FormattedMessage id="portal.form.confirmationBack" defaultMessage="Back to the portal" />
      </Link>
    </section>
  );
}
