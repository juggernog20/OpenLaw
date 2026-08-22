// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request's vocabulary on the portal (INT-001, INT-002): the R-###
 * reference, the row my-requests draws, and the four-state lifecycle
 * (INT-007) as a label and a pill.
 *
 * A Request is cited the way a Contract is — `contractReference` is the
 * sibling — so the two live in their own modules and read the same. The
 * status pill follows `STATUS_PILL` in `entities.ts`: a paired
 * background and foreground from one status family, keyed by the arm,
 * so a new arm is a compile error rather than an unstyled chip.
 *
 * **The lifecycle has two labels and one set of tokens** (the INT-003
 * M21/6 addendum). `requesterStatusLabel` is the requester's words and
 * `requestStatusLabel` is the enum's, and each surface picks the one
 * its reader speaks. The colours do not fork: an arm is the same status
 * family whoever is reading it, so there is one `REQUEST_STATUS_PILL`.
 *
 * The paper a Request carries lives here too (#380): where one
 * attachment is downloaded from, and the one call that puts one there.
 * The upload does not go through the generated client — `openapi-fetch`
 * types a `format: binary` field as a string and the thing being sent is
 * a `File` — so it is a plain same-origin `fetch` with a `FormData`
 * body, which is also what carries the session cookie and lets the
 * browser write the multipart boundary. That is the documents module's
 * rule, applied to the one upload the portal makes.
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";
import {
  REQUEST_DISPOSITIONED_PROBLEM_TYPE,
  REQUEST_OUTCOMES,
  type RequestOutcome,
} from "@openlaw/shared";
import { api } from "./api";
import type { CustomFieldValue } from "./custom-fields";
import { problemDetail, problemType } from "./messages";

/** One row of my-requests, aliased to the generated client schema so a
 * change to what the API answers surfaces here as a compile error. */
type ListResponse =
  paths["/api/v1/portal/requests"]["get"]["responses"]["200"]["content"]["application/json"];
export type MyRequestRow = ListResponse["requests"][number];

/** INT-007's lifecycle: open, became a record, answered in the thread,
 * or turned down. */
export type RequestStatus = MyRequestRow["status"];

/** The whole Request detail read: the envelope, the fields that name
 * the collected values, and the rows those values point at. */
type DetailResponse =
  paths["/api/v1/portal/requests/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
export type MyRequestField = DetailResponse["fields"][number];
export type MyRequestFieldRefs = DetailResponse["customFieldRefs"];
/** One file that travelled with the ask (INT-002). */
export type MyRequestAttachment = DetailResponse["attachments"][number];

/**
 * I5's and I7's status pills, on DES-005's paired status tokens: new is
 * information (the ask is open and nothing has been decided), converted
 * is success (it became real work), resolved is neutral (it is closed
 * and the outcome was not a rejection), and declined is danger — the one
 * terminal-negative arm, which the mocks have no row for.
 */
export const REQUEST_STATUS_PILL: Record<RequestStatus, string> = {
  new: "bg-status-info-bg text-status-info-fg",
  converted: "bg-status-success-bg text-status-success-fg",
  resolved: "bg-status-neutral-bg text-status-neutral-fg",
  declined: "bg-status-danger-bg text-status-danger-fg",
};

/**
 * The lifecycle in the enum's own words, for the surfaces staff read
 * (the INT-003 M21/6 addendum): the Inbox's triaged toggle and the
 * staff detail.
 *
 * A triager works the machinery, so the machinery's words are the ones
 * that carry facts they act on — `converted` says a record now exists,
 * which "In progress" does not.
 */
export function requestStatusLabel(intl: IntlShape, status: RequestStatus): string {
  return intl.formatMessage(
    {
      id: "requests.statusLabel",
      defaultMessage:
        "{status, select, new {New} converted {Converted} resolved {Resolved} " +
        "declined {Declined} other {Unknown}}",
    },
    { status },
  );
}

/**
 * The same lifecycle in the requester's words (the INT-003 M21/6
 * addendum): Open, In progress, Resolved, Declined.
 *
 * The requester's email has spoken these four words since M20/8. The
 * pill on my-requests and on the detail now speaks them too, so one
 * person is never told two names for one status — "Converted" in the
 * browser and "in progress" in the inbox was the M20/10 open item.
 *
 * The enum is untouched: this is a translation at the last moment
 * before a requester reads it, and `requestStatusLabel` is the same
 * translation for a triager.
 */
export function requesterStatusLabel(intl: IntlShape, status: RequestStatus): string {
  return intl.formatMessage(
    {
      id: "requests.requesterStatusLabel",
      defaultMessage:
        "{status, select, new {Open} converted {In progress} resolved {Resolved} " +
        "declined {Declined} other {Unknown}}",
    },
    { status },
  );
}

/** The whole staff request detail read (#414): the envelope, the
 * fields that name the collected values, the rows those values point
 * at, and the paper. Aliased to the generated client schema so a change
 * to what the staff read answers surfaces here as a compile error. */
type StaffDetailResponse =
  paths["/api/v1/requests/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
export type StaffRequest = StaffDetailResponse["request"];
export type StaffRequestField = StaffDetailResponse["fields"][number];
export type StaffRequestFieldRefs = StaffDetailResponse["customFieldRefs"];
export type StaffRequestAttachment = StaffDetailResponse["attachments"][number];

/** One row of the Inbox, aliased to the generated client schema so a
 * change to what the staff read answers surfaces here as a compile
 * error. */
type InboxResponse =
  paths["/api/v1/requests"]["get"]["responses"]["200"]["content"]["application/json"];
export type InboxRow = InboxResponse["requests"][number];
/** The front door a Request came through, with the routing bound to it. */
export type InboxRequestType = InboxRow["requestType"];

/**
 * The routing a request type carries, in words (INT-002's three-state
 * target): "Contract · NDA" names the type conversion will confirm,
 * "Contract" is the module alone with the type still owed at
 * conversion, and "No target" is an ask that may become no record at
 * all. Triage reads it before opening anything, because it says how
 * much of the routing is already decided (DD-018).
 */
export function requestTargetLabel(intl: IntlShape, target: InboxRequestType): string {
  if (target.targetModule === null) {
    return intl.formatMessage({ id: "inbox.target.none", defaultMessage: "No target" });
  }
  if (target.targetTypeName === null) {
    return intl.formatMessage(
      {
        id: "inbox.target.module",
        defaultMessage: "{module, select, matter {Matter} contract {Contract} other {No target}}",
      },
      { module: target.targetModule },
    );
  }
  return intl.formatMessage(
    {
      id: "inbox.target.moduleAndType",
      defaultMessage:
        "{module, select, matter {Matter · {name}} contract {Contract · {name}} other {{name}}}",
    },
    { module: target.targetModule, name: target.targetTypeName },
  );
}

/**
 * INT-002's global reference, as spoken and as linked: R-42.
 *
 * Grouping is turned off in the skeleton: a reference is an identity,
 * not a quantity, so the thousandth Request is R-1000 and never
 * R-1,000 — nor whatever separator another locale would reach for.
 */
export function requestReference(intl: IntlShape, number: number): string {
  return intl.formatMessage(
    { id: "requests.reference", defaultMessage: "R-{number, number, ::group-off}" },
    { number },
  );
}

/**
 * Where one attachment's bytes are fetched from.
 *
 * A plain same-origin address rather than a presigned URL: the file
 * comes through the API behind the session, so an anchor pointed here
 * downloads for the Requester and answers 404 to anybody else.
 */
export function requestAttachmentHref(number: number, attachmentId: string): string {
  return `/api/v1/portal/requests/${number}/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * What a disposition answers: the Request as it now stands, the outcome
 * somebody else recorded first, or an ordinary refusal to print
 * (INT-007).
 *
 * The lost race is its own arm rather than an error string, because it
 * is the one refusal a triager acts on: the answer is "somebody already
 * decided, here is what they decided", and every other refusal's answer
 * is "fix what you sent". The outcome comes off the RFC 9457 extension
 * member and never out of `detail`, which is copy.
 */
export type DispositionOutcome =
  | { ok: true; request: StaffRequest }
  | {
      ok: false;
      alreadyDecided: RequestOutcome;
      /** The record the winning conversion made, where this viewer
       * reaches it (DD-014). `null` on every other outcome, so a dialog
       * that names it draws the link only when there is one. */
      convertedContract: { number: number } | null;
    }
  | { ok: false; alreadyDecided?: undefined; detail?: string };

/**
 * Turns a Request down, with a reason (INT-006, INT-007).
 *
 * The reason is required by the seam and by the box that collects it —
 * one rule, refused in both places — because a decline is the whole of
 * the answer the requester gets. The seam stores it, mails it, and the
 * portal banner renders it as written.
 *
 * Nothing about the Request is written before this call: INT-007 has no
 * claim step, so the dialog opening is not an act and cancelling it
 * leaves the Request in the queue untouched.
 */
export async function declineRequest(number: number, reason: string): Promise<DispositionOutcome> {
  // Settled, never rejected: the dialog holds its button busy until this
  // answers, so a request that never arrived has to come back as an
  // ordinary refusal rather than as an escaping rejection.
  const { data, error } = await api
    .POST("/api/v1/requests/{number}/decline", {
      params: { path: { number } },
      body: { reason },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  if (data) return { ok: true, request: data.request };
  return refusal(error);
}

/**
 * Closes a Request that has been answered (INT-006, INT-007).
 *
 * The closing reply is optional, and an omitted one is genuinely
 * omitted: INT-006 asks for a reply rather than requiring one, because
 * the answer is often already on the thread and a second copy of it
 * would be noise. Given, it is posted as an ordinary Full Thread comment
 * and the requester hears about it as a reply, separately from the
 * closure itself.
 *
 * Nothing about the Request is written before this call, for the reason
 * a decline writes nothing before its own: INT-007 has no claim step, so
 * the dialog opening is not an act.
 */
export async function resolveRequest(number: number, reply?: string): Promise<DispositionOutcome> {
  // Settled, never rejected — `declineRequest`'s rule: the dialog holds
  // its button busy until this answers, so a request that never arrived
  // has to come back as an ordinary refusal rather than as an escaping
  // rejection.
  const { data, error } = await api
    .POST("/api/v1/requests/{number}/resolve", {
      params: { path: { number } },
      // Absent rather than empty. The seam refuses a blank reply, and it
      // is right to: a box of spaces is not an answer, and "no reply" is
      // said by sending no reply.
      body: reply === undefined ? {} : { reply },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  if (data) return { ok: true, request: data.request };
  return refusal(error);
}

/**
 * Turns a Request into the contract its request type targets (INT-002,
 * DD-018, INT-007).
 *
 * **The dialog sends what it drew and nothing more.** The title, the
 * contract type where the request type deferred it, and the answers to
 * the hard-required fields the form did not collect. The collected
 * values are not sent back: carry-through is the seam's rule (INT-002),
 * and a client that re-keyed them could drop one.
 *
 * `contractTypeId` is omitted where the request type already names a
 * live one — triage confirms the routing rather than choosing it
 * (DD-018), and the seam refuses a body that names a different type.
 *
 * Nothing about the Request is written before this call, for the reason
 * a decline writes nothing before its own: INT-007 has no claim step.
 */
export async function convertRequest(
  number: number,
  input: {
    title: string;
    contractTypeId?: string;
    customFields?: Record<string, CustomFieldValue>;
  },
): Promise<DispositionOutcome> {
  // Settled, never rejected — `declineRequest`'s rule.
  const { data, error } = await api
    .POST("/api/v1/requests/{number}/convert", {
      params: { path: { number } },
      body: {
        title: input.title,
        ...(input.contractTypeId === undefined ? {} : { contractTypeId: input.contractTypeId }),
        ...(input.customFields === undefined ? {} : { customFields: input.customFields }),
      },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  if (data) return { ok: true, request: data.request };
  return refusal(error);
}

/**
 * One refusal, read the same way by all three dispositions (INT-007,
 * TECH-020).
 *
 * The lost race is its own arm and every other refusal is a sentence to
 * print. Both halves of the race are checked: the problem type says
 * this is the race, and the extension members say what was recorded and
 * what it produced. A refusal that named the type but carried an
 * outcome this build has never heard of reads as an ordinary refusal,
 * because a client cannot state a decision it cannot name.
 */
function refusal(problem: unknown): DispositionOutcome {
  if (problemType(problem) === REQUEST_DISPOSITIONED_PROBLEM_TYPE) {
    const recorded = recordedOutcome(problem);
    if (recorded) {
      return { ok: false, alreadyDecided: recorded, convertedContract: recordedContract(problem) };
    }
  }
  return { ok: false, detail: problemDetail(problem) };
}

/** The decision on the refusal's own extension member, never out of
 * `detail` — that is copy, and copy is rewritten. */
function recordedOutcome(problem: unknown): RequestOutcome | null {
  if (!problem || typeof problem !== "object" || !("outcome" in problem)) return null;
  const { outcome } = problem as { outcome?: unknown };
  return REQUEST_OUTCOMES.find((candidate) => candidate === outcome) ?? null;
}

/**
 * The record a winning conversion made, off the second extension member
 * (#420).
 *
 * `null` covers three cases the client treats alike: the outcome made
 * no record, the seam withheld one this viewer cannot reach (DD-014),
 * and an older build that sent no member at all. In each of them the
 * dialog says what was decided without offering a link.
 */
function recordedContract(problem: unknown): { number: number } | null {
  if (!problem || typeof problem !== "object" || !("convertedContract" in problem)) return null;
  const { convertedContract } = problem as { convertedContract?: unknown };
  if (!convertedContract || typeof convertedContract !== "object") return null;
  const { number } = convertedContract as { number?: unknown };
  return typeof number === "number" && Number.isInteger(number) ? { number } : null;
}

/**
 * Where one attachment's bytes are fetched from on the staff side.
 *
 * The staff mount's own address, for the reason the read has one: same
 * rows, two projections, two gates (the M20/5 rule). An anchor pointed
 * here downloads for a Member+ and answers 403 to anybody below.
 */
export function staffRequestAttachmentHref(number: number, attachmentId: string): string {
  return `/api/v1/requests/${number}/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * How many files one ask may carry.
 *
 * The seam is what enforces it — a request past the bound is refused
 * there — and the picker restates it so a requester is told before they
 * queue thirty files rather than after. That is the composer's rule for
 * every bounded control on a form.
 */
export const MAX_REQUEST_ATTACHMENTS = 20;

/** Whether one file landed on the Request, and why it did not. A
 * disposition-raced upload names the Request thread that takes the
 * paper now (INT-002, CMT-011). */
export type AttachOutcome =
  { ok: true } | { ok: false; detail?: string; thread?: { requestNumber: number } };

/**
 * Attaches one file to a Request, and says whether it landed.
 *
 * One call per file, because the seam takes one file per call. The
 * caller is the submission, which has just created the Request — so a
 * refusal here is paper that did not travel with an ask that did. The
 * seam's own sentence is carried back rather than reduced to a failure:
 * "over the 100 MB upload limit" is something a requester can act on,
 * and "did not attach" is not.
 */
export async function attachToRequest(number: number, file: File): Promise<AttachOutcome> {
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    const response = await fetch(`/api/v1/requests/${number}/attachments`, {
      method: "POST",
      body: form,
    });
    if (response.ok) return { ok: true };
    return await attachmentRefusalIn(response);
  } catch {
    // A dropped connection reads as a file that did not attach, which
    // is what it is. The caller says so in its own words.
    return { ok: false };
  }
}

/** The seam's sentence, when the body carries one. */
async function attachmentRefusalIn(response: Response): Promise<AttachOutcome> {
  try {
    const problem: unknown = await response.json();
    const detail = problemDetail(problem);
    if (problemType(problem) !== REQUEST_DISPOSITIONED_PROBLEM_TYPE) {
      return { ok: false, detail };
    }
    const requestNumber = recordedRequestNumber(problem);
    return requestNumber === null
      ? { ok: false, detail }
      : { ok: false, detail, thread: { requestNumber } };
  } catch {
    return { ok: false };
  }
}

/** The Request whose portal detail is the stable address of its thread.
 * Read from the named refusal's extension member, never from copy. */
function recordedRequestNumber(problem: unknown): number | null {
  if (!isRecord(problem) || !isRecord(problem.request)) return null;
  const { number } = problem.request;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
