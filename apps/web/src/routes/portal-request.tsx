// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request detail (INT-001, INT-006, #379), from the I7 frame of
 * intake.pen: what a Requester sees when they open one of their own
 * asks.
 *
 * Three blocks, in I7's order: the envelope — the summary, the status,
 * and the "R-45 · Contract review · Submitted Aug 6" line — a banner
 * that says what the status means for the requester, and the "What you
 * submitted" card carrying the values the form collected.
 *
 * **The thread slots in between the banner and the card**, which is
 * where I7 draws it. It is ticket #381's, and nothing here reserves
 * space for it: a page that drew an empty conversation would be
 * claiming there is a conversation.
 *
 * **A converted Request opens like any other** (INT-001, DD-018), and
 * the page does not name what it became: a Business User cannot open a
 * Contract or a Matter, so a reference they could not follow would be a
 * dead end dressed as a fact. What the banner says is that Legal is
 * working on it and that this page is still their window.
 *
 * **A declined Request carries its reason** (INT-006): "no" always
 * arrives with a why, so the banner is the reason rather than a line
 * about it.
 *
 * ### Recorded normalization points (I7 deviations accepted)
 *
 * 1. I7 draws the Description as the thread's opening message. Nothing
 *    writes a comment row at submission — the Description is a column
 *    on the Request — so it is drawn as what it is: the first of the
 *    values in "What you submitted". The thread (#381) draws comment
 *    rows and nothing else.
 * 2. I7's "What you submitted" card carries an Attachments row. Uploads
 *    land with ticket #380; until they do the row is left out rather
 *    than drawn empty, because "no attachments" would be a claim about
 *    the Request that this build cannot make. (The submission form
 *    draws its inert Attachments box for the opposite reason: there it
 *    is a promise about a control, not a statement about a record.)
 * 3. I7 makes the card collapsible, with a chevron in its header. It
 *    renders open and fixed: the card is the whole of what the page has
 *    to say until the thread lands, and a control whose only state is
 *    "hide the page" is not a control.
 * 4. I7's field rows are 36px strips with a 200px label column. They
 *    render as a two-column grid that collapses to stacked rows in a
 *    narrow container (DES-012), and grow with their value — a
 *    Description is a paragraph, not a strip.
 */

import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { ChevronLeft, CircleCheck, CircleX, Info, PackageCheck } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { severityLabel } from "../lib/contracts";
import { isAnswered, type CustomFieldValue } from "../lib/custom-fields";
import { formatFullDate, formatShortDate } from "../lib/format";
import {
  REQUEST_STATUS_PILL,
  requestReference,
  requestStatusLabel,
  type MyRequestField,
  type MyRequestFieldRefs,
  type RequestStatus,
} from "../lib/requests";
import { currentUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { PortalShell } from "../components/portal/portal-shell";

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
  return { user, ...res.data };
}

export function PortalRequestPage() {
  const { user, request, fields, customFieldRefs } = useLoaderData<typeof portalRequestLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const reference = requestReference(intl, request.number);

  async function signOut() {
    await authClient.signOut();
    void navigate("/portal/enter", { replace: true });
  }

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      {/* Reference then summary, composed as one message — the
          separator is locale copy, not code (DES-013). The contract
          record's own document title is the sibling. */}
      <PageTitle
        title={intl.formatMessage(
          { id: "portal.request.documentTitle", defaultMessage: "{reference} · {summary}" },
          { reference, summary: request.summary },
        )}
      />
      <Link
        to="/portal"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
        <FormattedMessage id="portal.request.back" defaultMessage="Your requests" />
      </Link>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold">{request.summary}</h1>
          <span
            className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[request.status]}`}
          >
            {requestStatusLabel(intl, request.status)}
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
      <StatusBanner status={request.status} declinedReason={request.declinedReason} />
      <section
        aria-labelledby="portal-request-submitted-heading"
        className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
      >
        {/* A `div` rather than a `header`, the my-requests block's rule:
            the portal draws one banner, and a card strip that also
            claimed the role would make "the page header" mean two
            things. */}
        <div className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
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
          <ValueRow label={intl.formatMessage(BASIC_LABELS.urgency)}>
            {severityLabel(intl, request.urgency)}
          </ValueRow>
          {/* The type's own fields, in the order the form drew them.
              Only the ones that were answered: this card says what was
              submitted, and a row of dashes says what was not. */}
          {fields
            .filter((field) => isAnswered(request.customFields[field.slug]))
            .map((field) => (
              <ValueRow key={field.slug} label={field.displayName}>
                {renderValue(intl, field, request.customFields[field.slug]!, customFieldRefs)}
              </ValueRow>
            ))}
        </dl>
      </section>
    </PortalShell>
  );
}

/** The two basics this card draws, named exactly as the form named
 * them — two spellings would be two fields. */
const BASIC_LABELS = {
  description: defineMessage({ id: "portal.form.description", defaultMessage: "Description" }),
  urgency: defineMessage({ id: "portal.form.urgency", defaultMessage: "Urgency" }),
} as const;

/** One row of the card: the label and the value it names. A definition
 * list, because that is what a label-and-value pair is. */
function ValueRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="@container/row grid gap-x-4 gap-y-1 border-b border-border-muted px-4 py-2.5 last:border-b-0 @lg/row:grid-cols-value-row">
      <dt className="text-sm text-muted">{label}</dt>
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
 */
function StatusBanner({
  status,
  declinedReason,
}: Readonly<{ status: RequestStatus; declinedReason: string | null }>) {
  const { tone, Glyph } = BANNER_STYLE[status];
  return (
    <p className={`flex items-start gap-2 rounded-card px-3 py-2.5 text-sm font-medium ${tone}`}>
      <Glyph aria-hidden="true" className="mt-px size-4 shrink-0" />
      <span>
        <FormattedMessage {...BANNER_COPY[status]} />
        {status === "declined" && declinedReason !== null && (
          <>
            {" "}
            <span className="font-normal">{declinedReason}</span>
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
    defaultMessage: "Legal has answered this request.",
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
