// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The staff request detail (INT-006, INT-007, #414), from the I2 frame
 * of designs/intake.pen: what a Legal Team Member opens out of the
 * Inbox.
 *
 * Four things are on the page, in I2's order. The **sub-bar** carries
 * the trail back to the queue, the R-### reference, the ask, and the
 * status. The **hero** states the envelope: who asked, the front door
 * they came through, the routing the Administrator bound to it, how
 * urgent they said it is, and how long it has waited. The **main
 * column** is what was submitted — the Description, the collected
 * values labelled through the type's live fields, and the paper. The
 * **side column** shows what became of a Request once it has been triaged.
 *
 * **The thread is the chat applet**, the same one the contract record
 * mounts, keyed by the Request's own id (CMT-001, CMT-010). A Member+
 * is in every room on a Request, so the panel draws every tier and the
 * composer offers all three: Legal Only triage chatter and Full Thread
 * requester-facing replies live in one conversation (DD-016). Posting
 * one changes no status — the clarifying back-and-forth while a Request
 * is `new` is the point (INT-007), and the only thing on this page that
 * writes to the Request is its disposition.
 *
 * **The values are labelled by the form that collected them** and
 * resolved the way the portal detail resolves them (the INT-001 M20/10
 * rules, staff side): a `user` or `entity` value renders as a name,
 * archived rows included, and an id that resolves to nothing renders
 * raw — the Request does hold a value, and a dash would say it holds
 * none.
 *
 * The loader is the client half of INT-006's floor: Member+ only,
 * everyone else bounced home. The API's 403 is the real refusal.
 *
 * The sub-bar's Triage menu offers conversion to a contract or matter,
 * or resolution with a required explanatory note. Historical outcomes
 * remain readable once the Request has been decided.
 *
 * **Opening a disposition dialog writes nothing.** INT-007 has no claim
 * step and no parked state, so the Inbox row's Assign button is an entry
 * to the choice rather than an act, and cancelling returns the Request to
 * the queue untouched. One dialog is open at a time, because a Request
 * has one fate.
 *
 * ### Recorded normalization points (I2 deviations accepted)
 *
 * 1. The sub-bar now uses one Triage menu for both conversion targets
 *    and resolution, as agreed in the UX review.
 * 2. **The hero scrolls with the page** where I2 draws it as a second
 *    fixed band under the sub-bar. What it says is a fact about the
 *    Request rather than a control that must stay in reach, and a
 *    second chrome slab pushes the sticky bars past DES-011's bound on
 *    a short window.
 * 3. **I2's Triage card is not drawn.** It repeats the status pill in
 *    the sub-bar and the Urgency in the hero, and the mock predates
 *    INT-007 — there is no assignment and no parked state for that card
 *    to hold.
 * 4. **The Status card draws only once there is an outcome.** I2 draws
 *    it on a `new` Request saying what the Request would convert to;
 *    that is the routing, which the hero already states. Here it says
 *    what actually happened, so the promise and the fact are never two
 *    cards saying the same thing.
 * 5. **An attachment row carries no size and no uploader.** A Request's
 *    attachment stores neither — INT-002 calls them lightweight — and
 *    every file on a Request was put there by its Requester, whom the
 *    hero already names.
 * 6. **The activity bar carries the thread alone.** I2 draws a history
 *    slot beside it. Dispositions now narrate on the Request (#418,
 *    #419), but the activity read still has only a `contract` arm — an
 *    applet that opened on a refusal is worse than an absent one, so the
 *    slot waits for the read.
 *
 * **On a converted Request the applet is the record's thread** (CMT-001,
 * #422). The conversation moved onto the contract at the conversion and
 * the `request` audience arm follows the back-link, so this screen keeps
 * mounting the applet on the Request's own id and is answered the
 * record's rows — which is what "legal answers in exactly one place"
 * means from the triager's chair. A reply typed here and a reply typed
 * on the contract land in the same thread.
 */

import { formatShortDate } from "../lib/format";
import { useState } from "react";
import {
  redirect,
  Link,
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FilePen,
  FileText,
  BriefcaseBusiness,
} from "lucide-react";
import { api } from "../lib/api";
import { readRegistry } from "../lib/entities";
import { useCommentApplet } from "../components/comments/comment-applet";
import { AttachmentPreview } from "../components/comments/attachment-preview";
import { PreparedConvertDialog } from "../components/intake/prepared-convert-dialog";
import { CustomFieldValueText } from "../components/intake/custom-field-value";
import { RequestAssignment } from "../components/inbox/request-assignment";
import { ResolveDialog } from "../components/intake/resolve-dialog";
import {
  contractPath,
  contractReference,
  SEVERITY_PILL,
  severityLabel,
  type RegistryEntity,
  type UserOption,
} from "../lib/contracts";
import { matterPath, matterReference } from "../lib/matters";
import { isAnswered } from "../lib/custom-fields";
import { formatLongDateTime, formatRelativeOrShort } from "../lib/format";
import {
  convertRequest,
  resolveRequest,
  type DispositionOutcome,
  REQUEST_STATUS_PILL,
  requestReference,
  requestStatusLabel,
  requestTargetLabel,
  staffRequestAttachmentHref,
  type StaffRequest,
  type StaffRequestAttachment,
  type StaffRequestField,
  type StaffRequestFieldRefs,
} from "../lib/requests";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";
import { RecordApplets } from "../components/shell/record-applets";
import { Avatar } from "../components/avatar";
import { PageTitle } from "../components/page-title";
import { cn } from "../lib/utils";

export async function inboxRequestLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  // INT-006: triage stays legal's. A Contributor and a Business User get
  // no surface at all, not a disabled one; the API's 403 stands behind
  // this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const number = Number(params.number);
  // A reference that is not one lands back on the queue rather than on
  // the error boundary: a stale bookmark is not a fault a triager can
  // act on, and the Inbox is where the Requests they can open are.
  if (!Number.isInteger(number) || number < 1) return redirect("/inbox");
  // Load the Request and live creation options before opening Convert.
  // A failed workflow-settings read falls back to the ordinary manual dialog;
  // the other reads are required to show reachable, valid creation choices.
  const [res, options, matterOptions, registry, workflow] = await Promise.all([
    api.GET("/api/v1/requests/{number}", { params: { path: { number } } }),
    api.GET("/api/v1/contracts/options"),
    api.GET("/api/v1/matters/options"),
    readRegistry(),
    api.GET("/api/v1/conversion-drafts/settings").catch(() => null),
  ]);
  if (res.response.status === 404) return redirect("/inbox");
  if (!res.data || !options.data || !matterOptions.data || !registry.data) {
    throw new Error("The request could not be read.");
  }
  return {
    user,
    ...res.data,
    matterPreparation: workflow?.data?.matterPreparation ?? false,
    contractPreparation: workflow?.data?.contractPreparation ?? false,
    contractTypes: options.data.contractTypes,
    matterTypes: matterOptions.data.matterTypes,
    people: options.data.users,
    entities: registry.data.entities,
  };
}

export function InboxRequestPage() {
  const {
    user,
    request,
    fields,
    customFieldRefs,
    matterPreparation,
    contractPreparation,
    attachments,
    conversion,
    contractTypes,
    matterTypes,
    people,
    entities,
  } = useLoaderData<typeof inboxRequestLoader>();
  const intl = useIntl();
  const revalidator = useRevalidator();
  const reference = requestReference(intl, request.number);
  /** Which disposition dialog is open, if any. Opening one is not an
   * act: INT-007 has no claim step, so nothing about the Request changes
   * until the seam answers. One piece of state rather than one flag per
   * dialog, because a Request has one fate and two open dialogs would be
   * two answers to it. */
  const [disposing, setDisposing] = useState<"contract" | "matter" | "resolve" | null>(null);
  /** Whether a disposition is out. Every dialog holds its own submit
   * inert while it is, and the sub-bar's actions with it, so one press
   * is one disposition. */
  const [busy, setBusy] = useState(false);

  /** The conversation about this Request (CMT-004, CMT-010), keyed by
   * the entity reference the panel takes — it never learns it is a
   * Request. A Member+ is in every room on one, so the API answers
   * every tier and the composer offers all three (DD-016). */
  const chatApplet = useCommentApplet({
    enabled: request.status !== "converted",
    entityType: "request",
    entityId: request.id,
    role: user.role,
    viewerId: user.id,
  });

  const signOut = useSignOut("/auth/login");

  /**
   * Runs one disposition, and repaints the page from the record.
   *
   * The write answers the whole envelope, and the page still re-reads:
   * the Status card, the status pill, and the thread's own unread
   * watermark all hang off the loader, and one revalidation is what
   * keeps them from disagreeing. A resolution's closing reply is a
   * comment on that thread, so the re-read is what puts it there too.
   * The refusals go back to the dialog, which is where somebody can act
   * on them.
   *
   * One wrapper for every outcome, because what surrounds a disposition
   * is the same for all three — the busy flag, the repaint, and the
   * dialog closing on success. What differs is the call it is handed,
   * which is the seam's own shape (INT-007).
   */
  async function dispose(
    write: () => Promise<DispositionOutcome>,
    closeOnSuccess = true,
  ): Promise<DispositionOutcome> {
    setBusy(true);
    try {
      const result = await write();
      // A lost race repaints too, so the Request behind the dialog
      // already says what the other triager decided by the time it is
      // closed (INT-007).
      if (result.ok || result.alreadyDecided) void revalidator.revalidate();
      if (result.ok && closeOnSuccess) setDisposing(null);
      return result;
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      recordScope={{ entityType: "request", entityId: request.id }}
      flush
      subbar={
        <section
          aria-labelledby="page-title"
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-canvas px-page-x py-2 @5xl/shell:h-(--height-subbar) @5xl/shell:flex-nowrap @5xl/shell:py-0"
        >
          <div className="flex w-full min-w-0 items-center gap-2 @5xl/shell:w-auto @5xl/shell:flex-1">
            <Link
              to="/inbox"
              className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
            >
              <FormattedMessage id="inbox.title" defaultMessage="Inbox" />
            </Link>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
            <span className="shrink-0 text-base font-medium text-muted">{reference}</span>
            <h1 id="page-title" className="truncate text-md font-semibold">
              {request.summary}
            </h1>
            <span
              className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[request.status]}`}
            >
              {requestStatusLabel(intl, request.status)}
            </span>
          </div>
          {/* INT-007's disposition surface, and the whole triage
              surface: acting on a Request means choosing its outcome
              then and there. Drawn only while the Request is `new` —
              a decided one has nothing left to decide, and the Outcome
              card states what was decided. */}
          <RequestAssignment
            request={request}
            showName
            onAssigned={() => {
              void revalidator.revalidate();
            }}
          />
          {request.status === "new" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={busy} className="shrink-0">
                  <FormattedMessage id="inbox.request.triage" defaultMessage="Triage" />
                  <ChevronDown size={16} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDisposing("contract")}>
                  <FilePen size={16} aria-hidden="true" />
                  <FormattedMessage
                    id="inbox.request.convertContract"
                    defaultMessage="Convert to contract"
                  />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDisposing("matter")}>
                  <BriefcaseBusiness size={16} aria-hidden="true" />
                  <FormattedMessage
                    id="inbox.request.convertMatter"
                    defaultMessage="Convert to matter"
                  />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setDisposing("resolve")}>
                  <Check size={16} aria-hidden="true" />
                  <FormattedMessage
                    id="inbox.request.resolveWithoutConverting"
                    defaultMessage="Resolve request without converting"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </section>
      }
    >
      {(disposing === "contract" || disposing === "matter") && (
        <PreparedConvertDialog
          enabled={disposing === "matter" ? matterPreparation : contractPreparation}
          preparationSettings={{ matter: matterPreparation, contract: contractPreparation }}
          initialTargetModule={disposing}
          reference={reference}
          request={request}
          fields={fields}
          customFieldRefs={customFieldRefs}
          contractTypes={contractTypes}
          matterTypes={matterTypes}
          people={people.map((person: UserOption) => ({
            id: person.id,
            label: person.displayName,
            archived: person.archived,
          }))}
          entities={entities.map((entity: RegistryEntity) => ({
            id: entity.id,
            label: entity.legalName,
          }))}
          busy={busy}
          onClose={() => setDisposing(null)}
          onConvert={(input) => dispose(() => convertRequest(request.number, input), false)}
        />
      )}
      {disposing === "resolve" && (
        <ResolveDialog
          reference={reference}
          busy={busy}
          onClose={() => setDisposing(null)}
          onResolve={(reply) => dispose(() => resolveRequest(request.number, reply))}
        />
      )}
      {/* Reference then summary, composed as one message — the separator
          is locale copy, not code (DES-013). */}
      <PageTitle
        title={intl.formatMessage(
          { id: "inbox.request.documentTitle", defaultMessage: "{reference} · {summary}" },
          { reference, summary: request.summary },
        )}
      />
      <RecordApplets applets={request.status === "converted" ? [] : [chatApplet]}>
        <div className="flex h-full flex-col gap-4 overflow-y-auto px-page-x py-page-y">
          <Hero request={request} />
          {/* The record box rather than the page: opening the thread
              takes a column out of this row, so the two columns have to
              reflow against what is left of it (DES-012, DES-016). */}
          <div className="@container/body flex flex-col gap-4">
            <div
              className={cn(
                "grid grid-cols-1 gap-4",
                request.status !== "new" && "@4xl/body:grid-cols-[minmax(0,1fr)_20rem]",
              )}
            >
              <div className="flex min-w-0 flex-col gap-4">
                {request.description !== null && request.description !== "" && (
                  <Card
                    id="description"
                    heading={
                      <FormattedMessage
                        id="inbox.request.description"
                        defaultMessage="Description"
                      />
                    }
                  >
                    {/* A requester's paragraphs are theirs: the line
                        breaks they typed are part of what they said. */}
                    <p className="px-4 py-3 text-base whitespace-pre-line">{request.description}</p>
                  </Card>
                )}
                <Card
                  id="responses"
                  heading={
                    <FormattedMessage
                      id="inbox.request.responses"
                      defaultMessage="Form responses"
                    />
                  }
                >
                  <FormResponses
                    request={request}
                    fields={fields}
                    customFieldRefs={customFieldRefs}
                  />
                </Card>
                {request.status !== "converted" && (
                  <Card
                    id="attachments"
                    heading={
                      <FormattedMessage
                        id="inbox.request.attachments"
                        defaultMessage="Attachments"
                      />
                    }
                  >
                    <Attachments number={request.number} attachments={attachments} />
                  </Card>
                )}
              </div>
              {request.status !== "new" && (
                <div className="flex min-w-0 flex-col gap-4">
                  <Card
                    id="outcome"
                    heading={
                      <FormattedMessage id="inbox.request.outcome" defaultMessage="Status" />
                    }
                  >
                    <Outcome request={request} />
                    {conversion && (
                      <p className="px-4 pb-3 text-sm text-muted">
                        <FormattedMessage
                          id="inbox.request.convertedBy"
                          defaultMessage="Converted by {person} on {date}"
                          values={{
                            person: conversion.by ?? "",
                            date: formatShortDate(conversion.at),
                          }}
                        />
                      </p>
                    )}
                  </Card>
                </div>
              )}
            </div>
          </div>
        </div>
      </RecordApplets>
    </AppShell>
  );
}

/**
 * I2's hero: the envelope, as five facts on one strip.
 *
 * The routing sits beside the front door rather than inside it, because
 * "Contract · NDA" and "Contract review" answer different questions:
 * one is the form the requester filled in, the other is how much of the
 * conversion is already decided (DD-018, INT-002).
 */
function Hero({ request }: Readonly<{ request: StaffRequest }>) {
  const intl = useIntl();
  return (
    // A named landmark rather than a bare strip: it carries no heading
    // of its own, so without a name it is the one block on this page a
    // reader cannot reach or refer to by role. Every card here is a
    // named region already (DES-011).
    <section
      aria-label={intl.formatMessage({ id: "inbox.request.overview", defaultMessage: "Overview" })}
      className="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-card border border-border-default bg-raised px-4 py-3"
    >
      <HeroItem label={<FormattedMessage id="inbox.column.requester" defaultMessage="Requester" />}>
        <span className="flex items-center gap-1.5">
          <Avatar
            name={request.requester.displayName}
            image={request.requester.image}
            className="size-6"
          />
          {request.requester.displayName}
        </span>
      </HeroItem>
      <HeroItem label={<FormattedMessage id="inbox.column.type" defaultMessage="Type" />}>
        {request.requestType.displayName}
      </HeroItem>
      <HeroItem label={<FormattedMessage id="inbox.request.target" defaultMessage="Converts to" />}>
        {requestTargetLabel(intl, request.requestType)}
      </HeroItem>
      <HeroItem label={<FormattedMessage id="inbox.column.urgency" defaultMessage="Urgency" />}>
        <span
          className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${SEVERITY_PILL[request.urgency]}`}
        >
          {severityLabel(intl, request.urgency)}
        </span>
      </HeroItem>
      <HeroItem
        label={<FormattedMessage id="inbox.request.submitted" defaultMessage="Submitted" />}
      >
        {/* How long it has waited, which is what triage weighs; the
            stamp itself is one hover away (DES-014). */}
        <time
          dateTime={request.createdAt}
          title={formatLongDateTime(request.createdAt, { locale: intl.locale })}
        >
          {formatRelativeOrShort(request.createdAt, { locale: intl.locale })}
        </time>
      </HeroItem>
    </section>
  );
}

/** One fact on the hero strip: the label above the value it names. */
function HeroItem({
  label,
  children,
}: Readonly<{ label: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="flex items-center gap-1.5 text-base">{children}</span>
    </div>
  );
}

/** The card chrome every block on this page wears — the section strip
 * the record page and the portal detail already draw. */
function Card({
  id,
  heading,
  note,
  children,
}: Readonly<{
  id: string;
  heading: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <section
      aria-labelledby={`inbox-request-${id}-heading`}
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id={`inbox-request-${id}-heading`} className="text-base font-semibold">
          {heading}
        </h2>
        {note && <span className="text-sm text-muted">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * What the form collected, named by the boxes that collected it.
 *
 * Only the fields that were answered: this card says what was
 * submitted, and a row of dashes says what was not. A value whose field
 * has since been detached or archived is not among `fields` at all, so
 * it is not drawn — the label that would name it is no longer on this
 * form.
 */
function FormResponses({
  request,
  fields,
  customFieldRefs,
}: Readonly<{
  request: StaffRequest;
  fields: readonly StaffRequestField[];
  customFieldRefs: StaffRequestFieldRefs;
}>) {
  const answered = fields.filter((field) => isAnswered(request.customFields[field.slug]));
  if (answered.length === 0) {
    return (
      <p className="px-4 py-3 text-base text-muted">
        <FormattedMessage
          id="inbox.request.noResponses"
          defaultMessage="This form collected nothing beyond the basics."
        />
      </p>
    );
  }
  return (
    <dl className="flex flex-col">
      {answered.map((field) => (
        <div
          key={field.slug}
          className="@container/row grid gap-x-4 gap-y-1 border-b border-border-muted px-4 py-2.5 last:border-b-0 @lg/row:grid-cols-value-row"
        >
          <dt className="text-sm text-muted">{field.displayName}</dt>
          <dd className="min-w-0 text-base break-words">
            <CustomFieldValueText
              field={field}
              value={request.customFields[field.slug]!}
              refs={customFieldRefs}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Submitted files open in the shared attachment viewer, with separate downloads. */
function Attachments({
  number,
  attachments,
}: Readonly<{ number: number; attachments: readonly StaffRequestAttachment[] }>) {
  const intl = useIntl();
  const [previewAttachment, setPreviewAttachment] = useState<StaffRequestAttachment | null>(null);
  if (attachments.length === 0) {
    return (
      <p className="px-4 py-3 text-base text-muted">
        <FormattedMessage
          id="inbox.request.noAttachments"
          defaultMessage="No files travelled with this request."
        />
      </p>
    );
  }
  return (
    <>
      <ul className="flex flex-col">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="flex items-center gap-2 border-b border-border-muted px-4 py-2.5 last:border-b-0"
          >
            <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <button
              type="button"
              onClick={() => setPreviewAttachment(attachment)}
              className="min-w-0 rounded-chip text-left break-all text-base text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
            >
              {attachment.filename}
            </button>
            <Button asChild variant="ghost" size="sm" className="ms-auto shrink-0">
              <a
                download={attachment.filename}
                href={staffRequestAttachmentHref(number, attachment.id)}
                aria-label={intl.formatMessage(
                  { id: "comments.attachments.download", defaultMessage: "Download {filename}" },
                  { filename: attachment.filename },
                )}
              >
                <Download size={16} aria-hidden="true" />
              </a>
            </Button>
          </li>
        ))}
      </ul>
      {previewAttachment && (
        <AttachmentPreview
          key={previewAttachment.id}
          filename={previewAttachment.filename}
          href={staffRequestAttachmentHref(number, previewAttachment.id)}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
}

/**
 * What became of a triaged Request (INT-007).
 *
 * A conversion names the record when this viewer reaches it and says so
 * without one when they do not — the API decides that (DD-014), and
 * this screen never has a reference it must hide. A decline carries the
 * recorded reason itself, because INT-006 makes "no" arrive with a why
 * and a line *about* a reason is not the reason.
 */
function Outcome({ request }: Readonly<{ request: StaffRequest }>) {
  const intl = useIntl();
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <span className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[request.status]}`}
        >
          {requestStatusLabel(intl, request.status)}
        </span>
        {request.convertedRecord && (
          <Link
            to={
              request.convertedRecord.module === "matter"
                ? matterPath(request.convertedRecord.number)
                : contractPath(request.convertedRecord.number)
            }
            className="rounded-chip text-base font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            {request.convertedRecord.module === "matter"
              ? matterReference(intl, request.convertedRecord.number)
              : contractReference(intl, request.convertedRecord.number)}
          </Link>
        )}
      </span>
      {request.status === "declined" && request.declinedReason !== null && (
        <p className="text-base whitespace-pre-line">{request.declinedReason}</p>
      )}
    </div>
  );
}
