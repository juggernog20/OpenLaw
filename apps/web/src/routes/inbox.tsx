// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Inbox destination (INT-006, INT-007, #413), per the I1 frame of
 * designs/intake.pen: nav slot one, and the queue of Requests whose
 * fate is undecided.
 *
 * **The columns are I1's, as INT-007 revised them**: the R-###
 * reference, the ask, the front door with the routing bound to it, who
 * asked, how urgent they said it is, how long it has waited, and the
 * Assign button that opens the disposition. There is no Status column
 * and no Assignee column, because there is no assignment and there is
 * only one status in the queue — everything here is `new`, which is
 * what makes the list read truthfully as "requests whose fate is
 * undecided".
 *
 * **The toggle is the only control.** I1 also draws Type and Urgency
 * filter chips and the managed-table Filter and Columns buttons; the
 * Inbox is a fixed queue rather than a curated destination list, so
 * DD-019's machinery is not built here and neither are the chips. Show
 * triaged is the one thing INT-007 asks for, and turning it on adds the
 * converted, resolved, and declined Requests with an Outcome column
 * that says which they are.
 *
 * **A converted row's link is the server's to give.** The API answers
 * the record only when this viewer reaches it (DD-014, CTR-018), so a
 * row with no link is a row the server withheld one from — this screen
 * never decides that and never has a reference it must hide. The
 * outcome still shows: the Request is triage's business whatever
 * became of it.
 *
 * The order is the API's — urgency rank, then age — and the foot says
 * so, because a queue whose ordering is a product decision should not
 * make the reader infer it.
 *
 * The loader is the client half of INT-006's floor: Member+ only,
 * everyone else bounced home. The API's 403 is the real refusal.
 */

import { useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Inbox, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { contractPath, contractReference, SEVERITY_PILL, severityLabel } from "../lib/contracts";
import { formatRelativeOrShort } from "../lib/format";
import {
  requestReference,
  requestStatusLabel,
  requestTargetLabel,
  REQUEST_STATUS_PILL,
  type InboxRow,
} from "../lib/requests";
import { isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

/** Where one Request opens: the staff detail, under the destination it
 * was picked up from. The portal keeps its own address for the same
 * row — two audiences, two reads, and neither route means two things. */
export function inboxRequestPath(number: number): string {
  return `/inbox/${number}`;
}

export async function inboxLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // INT-006: triage stays legal's. A Contributor and a Business User get
  // no surface at all, not a disabled one; the API's 403 stands behind
  // this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const list = await api.GET("/api/v1/requests");
  if (!list.data) throw new Error("The Inbox could not be read.");
  return { user, requests: list.data.requests, nextCursor: list.data.nextCursor };
}

export function InboxPage() {
  const loaded = useLoaderData<typeof inboxLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<InboxRow[]>(loaded.requests);
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  const [showTriaged, setShowTriaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  /** What the sub-bar counts: the undecided ones on screen. A triaged
   * Request has left the queue, so it is not part of the number even
   * when the toggle is drawing it. */
  const awaiting = rows.filter((row) => row.status === "new").length;

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  /** The one query this list asks. The toggle rides on every read,
   * cursor included: a cursor is a position in one ordering, and a page
   * read under a different one is a page of a different list. */
  const listQuery = (triaged: boolean) => (triaged ? { includeTriaged: "true" as const } : {});

  /** Turning the toggle re-reads the queue: the triaged rows only exist
   * server-side, and coming back should not trust a stale list either. */
  async function toggleTriaged(next: boolean) {
    if (busy) return;
    setListError(null);
    setBusy(true);
    const { data } = await api
      .GET("/api/v1/requests", { params: { query: listQuery(next) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "inbox.listError",
          defaultMessage: "The Inbox could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.requests);
    setCursor(data.nextCursor);
    setShowTriaged(next);
  }

  /** One more page, appended in place — the house pattern, and the only
   * honest answer for a list with no total to state. */
  async function showMore() {
    if (busy || cursor === null) return;
    setListError(null);
    setBusy(true);
    const { data } = await api
      .GET("/api/v1/requests", { params: { query: { cursor, ...listQuery(showTriaged) } } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "inbox.moreError",
          defaultMessage: "The next requests could not be read. Try again.",
        }),
      );
      return;
    }
    setRows((current) => [...current, ...data.requests]);
    setCursor(data.nextCursor);
  }

  return (
    <AppShell
      user={loaded.user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="inbox.title" defaultMessage="Inbox" />}
          subtitle={
            // What is on screen. There is no total to state — the queue
            // is keyset-paged — so a bare count over a longer list would
            // be a number the page cannot stand behind.
            cursor === null ? (
              <FormattedMessage
                id="inbox.awaiting"
                defaultMessage="{count} awaiting triage"
                values={{ count: awaiting }}
              />
            ) : (
              <FormattedMessage
                id="inbox.awaitingShown"
                defaultMessage="{count} awaiting triage shown"
                values={{ count: awaiting }}
              />
            )
          }
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "inbox.title", defaultMessage: "Inbox" })} />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          {listError && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {listError}
            </p>
          )}
          <Label htmlFor="inbox-show-triaged">
            <FormattedMessage id="inbox.showTriaged" defaultMessage="Show triaged" />
          </Label>
          <Switch
            id="inbox-show-triaged"
            checked={showTriaged}
            disabled={busy}
            onCheckedChange={(next) => void toggleTriaged(next)}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyInbox />
        ) : (
          <>
            <QueueTable rows={rows} showOutcome={showTriaged} />
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="inbox.ordering"
                  defaultMessage="Ordered by urgency, then age"
                />
              </p>
              {cursor !== null && (
                <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
                  <FormattedMessage id="inbox.more" defaultMessage="Show more" />
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

/** Zero reads as the good news it is (INT-006): the queue is empty
 * because everything that arrived has been decided, and the screen says
 * that rather than drawing an empty table. */
function EmptyInbox() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      <Inbox size={24} aria-hidden="true" className="text-subtle" />
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">
          <FormattedMessage id="inbox.empty.title" defaultMessage="Nothing is waiting" />
        </h2>
        <p className="max-w-md text-base text-muted">
          <FormattedMessage
            id="inbox.empty.body"
            defaultMessage={
              "Every Request has been decided. New ones land here as they " +
              "arrive, hottest and oldest first."
            }
          />
        </p>
      </div>
    </div>
  );
}

/** I1's table. The Outcome column is drawn only where there can be an
 * outcome to draw — the default queue is all `new`, and a column of one
 * repeated word says nothing. */
function QueueTable({ rows, showOutcome }: Readonly<{ rows: InboxRow[]; showOutcome: boolean }>) {
  const intl = useIntl();
  return (
    <div className="overflow-x-auto rounded-card border border-border-default bg-raised">
      <table className="w-full">
        <thead>
          <tr className="bg-section-header text-start text-sm font-medium text-muted">
            <th scope="col" className="w-20 px-4 py-2 text-start font-medium">
              <FormattedMessage id="inbox.column.reference" defaultMessage="Ref" />
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              <FormattedMessage id="inbox.column.summary" defaultMessage="Summary" />
            </th>
            <th scope="col" className="w-48 px-4 py-2 text-start font-medium">
              <FormattedMessage id="inbox.column.type" defaultMessage="Type" />
            </th>
            <th scope="col" className="w-40 px-4 py-2 text-start font-medium">
              <FormattedMessage id="inbox.column.requester" defaultMessage="Requester" />
            </th>
            <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
              <FormattedMessage id="inbox.column.urgency" defaultMessage="Urgency" />
            </th>
            <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
              <FormattedMessage id="inbox.column.age" defaultMessage="Age" />
            </th>
            {showOutcome && (
              <th scope="col" className="w-40 px-4 py-2 text-start font-medium">
                <FormattedMessage id="inbox.column.outcome" defaultMessage="Outcome" />
              </th>
            )}
            <th scope="col" className="w-32 px-4 py-2 text-end font-medium">
              <span className="sr-only">
                <FormattedMessage id="inbox.column.actions" defaultMessage="Actions" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const reference = requestReference(intl, row.number);
            return (
              <tr key={row.id} className="border-t border-border-default">
                <td className="px-4 py-2.5 text-sm font-semibold text-muted">{reference}</td>
                <td className="px-4 py-2.5">
                  <Link
                    to={inboxRequestPath(row.number)}
                    className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                  >
                    {row.summary}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-col">
                    <span className="text-sm text-primary">{row.requestType.displayName}</span>
                    {/* The routing the Administrator bound, so triage
                        can see how much of it is already decided. */}
                    <span className="text-xs text-muted">
                      {requestTargetLabel(intl, row.requestType)}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm">{row.requester.displayName}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${SEVERITY_PILL[row.urgency]}`}
                  >
                    {severityLabel(intl, row.urgency)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm text-muted">
                  {formatRelativeOrShort(row.createdAt, { locale: intl.locale })}
                </td>
                {showOutcome && (
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[row.status]}`}
                      >
                        {requestStatusLabel(intl, row.status)}
                      </span>
                      {row.convertedContract && (
                        <Link
                          to={contractPath(row.convertedContract.number)}
                          className="rounded-chip text-sm font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                        >
                          {contractReference(intl, row.convertedContract.number)}
                        </Link>
                      )}
                    </span>
                  </td>
                )}
                <td className="px-4 py-2.5 text-end">
                  {/* INT-007: no claim step and no parked state —
                      Assign is the entry to the disposition, and it
                      opens the Request where the three actions live. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    asChild
                    aria-label={intl.formatMessage(
                      { id: "inbox.assignRow", defaultMessage: "Assign {reference}" },
                      { reference },
                    )}
                  >
                    <Link to={inboxRequestPath(row.number)}>
                      <UserPlus size={16} aria-hidden="true" />
                      <FormattedMessage id="inbox.assign" defaultMessage="Assign" />
                    </Link>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
