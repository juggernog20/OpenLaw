// SPDX-License-Identifier: AGPL-3.0-only

/** Portal Requests keep the submitted ask in the page and shared Conversation
 * and History in applets (DES-079). Conversion redirects to the record; an
 * archived destination leaves only the read-only original submission. */

import { RequestExpectation } from "../components/portal/request-expectation";
import { HelpLink } from "../components/documentation/help-link";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { CircleCheck, CircleX, FileText, Info, PackageCheck } from "lucide-react";
import { api } from "../lib/api";
import { severityLabel } from "../lib/contracts";
import { isAnswered, type CustomFieldValue } from "../lib/custom-fields";
import { formatFullDate, formatShortDate } from "../lib/format";
import {
  REQUEST_STATUS_PILL,
  requestAttachmentHref,
  requestReference,
  requesterStatusLabel,
  type MyRequestAttachment,
  type MyRequestField,
  type MyRequestFieldRefs,
  type RequestStatus,
} from "../lib/requests";
import { currentUser, useSignOut } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { PortalBackLink } from "../components/portal/back-link";
import { PortalRecordShell } from "../components/portal/record-shell";

export async function portalRequestLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const number = Number(params.number);
  if (!Number.isInteger(number) || number < 1) return redirect("/portal");
  const res = await api.GET("/api/v1/portal/requests/{number}", {
    params: { path: { number } },
  });
  // A reference nobody has and a reference somebody else has are the
  // same 404 (DD-013), and neither is a fault a requester can act on.
  // So both land back on the portal home, where their own list is —
  // the rule the form's loader already applies to a stale form link.
  if (res.response.status === 404) return redirect("/portal");
  if (!res.data) throw new Error("The request could not be read.");
  if (res.data.redirectTo)
    return redirect(`/portal/${res.data.redirectTo.module}s/${res.data.redirectTo.number}`);
  if (res.data.recordArchived) return { user, ...res.data, thread: null };
  // The thread is keyed by the Request's own id (CMT-010), which only
  // the detail read answers — so it is asked second rather than beside
  // it. A read that fails answers `null` rather than taking the page
  // down with it: the values the requester submitted are still theirs to
  // see, and the card says the conversation could not be read.
  // Caught as well as checked: a non-2xx answers `data: undefined`, and
  // a request that never arrives rejects. Both are the same fact to this
  // page — there is no conversation to draw — and neither is a reason to
  // take the rest of it away.
  return { user, ...res.data };
}

export function PortalRequestPage() {
  const { user, request, fields, customFieldRefs, attachments, recordArchived } =
    useLoaderData<typeof portalRequestLoader>();
  const intl = useIntl();
  const reference = requestReference(intl, request.number);

  const signOut = useSignOut("/portal/enter");

  return (
    <PortalRecordShell
      key={request.id}
      entityType="request"
      entityId={recordArchived ? undefined : request.id}
      number={request.number}
      viewerId={user.id}
      user={user}
      onSignOut={() => void signOut()}
      recordScope={{ entityType: "request", entityId: request.id }}
    >
      {/* Reference then summary, composed as one message — the
          separator is locale copy, not code (DES-013). The contract
          record's own document title is the sibling. */}
      <PageTitle
        title={intl.formatMessage(
          { id: "portal.request.documentTitle", defaultMessage: "{reference} · {summary}" },
          { reference, summary: request.summary },
        )}
      />
      <PortalBackLink>
        <FormattedMessage id="portal.request.back" defaultMessage="Your requests" />
      </PortalBackLink>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-semibold break-words">{request.summary}</h1>
          <span
            className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[request.status]}`}
          >
            {requesterStatusLabel(intl, request.status)}
          </span>
        </div>
        {/* I7's meta line: the reference, the front door, and the day it
            was asked, separated the way the mock separates them. */}
        <p className="text-sm text-muted">
          <FormattedMessage
            id="portal.request.meta"
            defaultMessage="{reference} · {requestType} · Submitted {submitted}"
            values={{
              reference,
              requestType: request.requestType.displayName,
              submitted: formatShortDate(request.createdAt),
            }}
          />
        </p>
      </div>
      <HelpLink surface="portal" contextual />
      <div className="flex flex-col gap-section-gap">
        <div className="flex min-w-0 flex-col gap-4">
          {recordArchived ? (
            <p className="text-base text-muted">
              <FormattedMessage
                id="portal.request.archivedRecord"
                defaultMessage="The record created from this Request was archived. Your original request is shown below."
              />
            </p>
          ) : (
            <>
              <RequestExpectation request={request} />
              <StatusBanner status={request.status} declinedReason={request.declinedReason} />
            </>
          )}
        </div>
        <aside className="min-w-0">
          <section
            aria-labelledby="portal-request-submitted-heading"
            className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
          >
            {/* A `div` rather than a `header`, the my-requests block's
                rule: the portal draws one banner, and a card strip that
                also claimed the role would make "the page header" mean
                two things. */}
            <div className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
              <h2 id="portal-request-submitted-heading" className="text-base font-semibold">
                <FormattedMessage
                  id="portal.request.submittedHeading"
                  defaultMessage="What you submitted"
                />
              </h2>
            </div>
            <dl className="flex flex-col">
              {request.description !== null && request.description !== "" && (
                <ValueRow label={intl.formatMessage(BASIC_LABELS.description)}>
                  {/* A requester's paragraphs are theirs: the line breaks
                      they typed are part of what they said. */}
                  <span className="whitespace-pre-line">{request.description}</span>
                </ValueRow>
              )}
              {attachments.length > 0 && (
                <ValueRow label={intl.formatMessage(BASIC_LABELS.attachments)}>
                  <AttachmentList number={request.number} attachments={attachments} />
                </ValueRow>
              )}
              <ValueRow label={intl.formatMessage(BASIC_LABELS.urgency)}>
                {severityLabel(intl, request.urgency)}
              </ValueRow>
              {/* The type's own fields, in the order the form drew them.
                  Only the ones that were answered: this card says what
                  was submitted, and a row of dashes says what was not. */}
              {fields
                .filter((field) => isAnswered(request.customFields[field.slug]))
                .map((field) => (
                  <ValueRow key={field.slug} label={field.displayName}>
                    {renderValue(intl, field, request.customFields[field.slug]!, customFieldRefs)}
                  </ValueRow>
                ))}
            </dl>
          </section>
        </aside>
      </div>
    </PortalRecordShell>
  );
}

/** The two basics this card draws, named exactly as the form named
 * them — two spellings would be two fields. */
const BASIC_LABELS = {
  description: defineMessage({ id: "portal.form.description", defaultMessage: "Description" }),
  attachments: defineMessage({ id: "portal.form.attachments", defaultMessage: "Attachments" }),
  urgency: defineMessage({ id: "portal.form.urgency", defaultMessage: "Urgency" }),
} as const;

/**
 * The paper that travelled with the ask, each name the link that
 * downloads it.
 *
 * A plain anchor rather than a fetch: the address is same-origin and
 * behind the session, so the browser's own download is the whole
 * mechanism. `download` asks it to save under the name the file arrived
 * with, which is the name the response's own disposition already
 * carries — the attribute only spares a requester a tab that opens and
 * closes again.
 */
function AttachmentList({
  number,
  attachments,
}: Readonly<{ number: number; attachments: readonly MyRequestAttachment[] }>) {
  return (
    <ul className="flex flex-col gap-1">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="flex items-center gap-1.5">
          <FileText aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <a
            download
            href={requestAttachmentHref(number, attachment.id)}
            className="min-w-0 break-all text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            {attachment.filename}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** One row of the card: the label and the value it names. A definition
 * list, because that is what a label-and-value pair is. */
function ValueRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="@container/row grid gap-x-4 gap-y-1 border-b border-border-muted px-4 py-3 last:border-b-0 @lg/row:grid-cols-value-row">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="min-w-0 text-base break-words">{children}</dd>
    </div>
  );
}

/**
 * The banner under the envelope: what the status means for the person
 * who asked.
 *
 * `new` is I7's own line. The other three are this build's, because M21
 * writes the statuses and I7 draws only a new Request. Each says the
 * one thing a requester needs from that arm — and `declined` says the
 * reason itself, because INT-006 makes "no" arrive with a why.
 *
 * `resolved` says the Request was answered *and closed* (the INT-003
 * M21/6 addendum). An answered Request is also a closed one, and a
 * Requester who is not told it is closed goes on waiting for a second
 * reply.
 */
function StatusBanner({
  status,
  declinedReason,
}: Readonly<{ status: RequestStatus; declinedReason: string | null }>) {
  const { tone, Glyph } = BANNER_STYLE[status];
  return (
    <p className={`flex items-start gap-2.5 rounded-card px-4 py-3 text-base font-medium ${tone}`}>
      <Glyph aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <FormattedMessage {...BANNER_COPY[status]} />
        {status === "declined" && declinedReason !== null && (
          <>
            {" "}
            <span className="font-normal">{declinedReason}</span>
          </>
        )}
        {status !== "new" && (
          <>
            {" "}
            <FormattedMessage
              id="portal.request.paperOnThread"
              defaultMessage="<composer>Attach new files to a reply</composer>."
              values={{
                composer: (chunks) => (
                  <a
                    href="#portal-request-composer"
                    className="font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                  >
                    {chunks}
                  </a>
                ),
              }}
            />
          </>
        )}
      </span>
    </p>
  );
}

/** The banner wears its status's own paired tokens, so it and the pill
 * beside it are never two different opinions about the same arm. */
const BANNER_STYLE: Record<RequestStatus, { tone: string; Glyph: typeof Info }> = {
  new: { tone: "bg-status-info-bg text-status-info-fg", Glyph: Info },
  converted: { tone: "bg-status-success-bg text-status-success-fg", Glyph: PackageCheck },
  resolved: { tone: "bg-status-neutral-bg text-status-neutral-fg", Glyph: CircleCheck },
  declined: { tone: "bg-status-danger-bg text-status-danger-fg", Glyph: CircleX },
};

const BANNER_COPY = {
  new: defineMessage({
    id: "portal.request.bannerNew",
    defaultMessage: "Legal has received your request. You'll get an email when the status changes.",
  }),
  converted: defineMessage({
    id: "portal.request.bannerConverted",
    defaultMessage: "Legal is working on this. Follow it here.",
  }),
  resolved: defineMessage({
    id: "portal.request.bannerResolved",
    defaultMessage: "Legal has answered this request and closed it.",
  }),
  declined: defineMessage({
    id: "portal.request.bannerDeclined",
    defaultMessage: "Legal declined this request.",
  }),
} as const;

/**
 * One collected value, drawn the way its field type reads.
 *
 * The two types that name a row are resolved by the API — a bare id is
 * not a value anybody can read — and an id that resolves to nothing
 * falls back to the id, because a Request that holds one must go on
 * showing that it holds something.
 */
function renderValue(
  intl: IntlShape,
  field: MyRequestField,
  value: CustomFieldValue,
  refs: MyRequestFieldRefs,
): React.ReactNode {
  switch (field.fieldType) {
    case "number":
      return typeof value === "number" ? intl.formatNumber(value) : String(value);
    case "date":
      return typeof value === "string" ? formatFullDate(value) : String(value);
    case "boolean":
      return intl.formatMessage(
        {
          id: "portal.request.booleanValue",
          defaultMessage: "{value, select, true {Yes} other {No}}",
        },
        { value: String(value === true) },
      );
    case "multi_select":
      return Array.isArray(value) ? intl.formatList(value, { type: "conjunction" }) : String(value);
    case "user":
      return refs.users.find((person) => person.id === value)?.displayName ?? String(value);
    case "entity":
      return refs.entities.find((row) => row.id === value)?.legalName ?? String(value);
    case "long_text":
      return <span className="whitespace-pre-line">{String(value)}</span>;
    default:
      return String(value);
  }
}
