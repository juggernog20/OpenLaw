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
import { problemDetail } from "./messages";

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
 * How many files one ask may carry.
 *
 * The seam is what enforces it — a request past the bound is refused
 * there — and the picker restates it so a requester is told before they
 * queue thirty files rather than after. That is the composer's rule for
 * every bounded control on a form.
 */
export const MAX_REQUEST_ATTACHMENTS = 20;

/** Whether one file landed on the Request, and why it did not. */
export type AttachOutcome = { ok: true } | { ok: false; detail?: string };

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
    return { ok: false, detail: await refusalIn(response) };
  } catch {
    // A dropped connection reads as a file that did not attach, which
    // is what it is. The caller says so in its own words.
    return { ok: false };
  }
}

/** The seam's sentence, when the body carries one. */
async function refusalIn(response: Response): Promise<string | undefined> {
  try {
    return problemDetail(await response.json());
  } catch {
    return undefined;
  }
}
