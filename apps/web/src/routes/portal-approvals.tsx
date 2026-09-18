// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Link,
  redirect,
  useLoaderData,
  useRevalidator,
  useNavigate,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft, Check, CheckCheck, Clock3, Download, FileText, Search, X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { MAX_APPROVAL_NOTE_LENGTH } from "@openlaw/shared";
import { api } from "../lib/api";
import { currentUserFor, useSignOut } from "../lib/session";
import { PortalShell } from "../components/portal/portal-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Avatar } from "../components/avatar";
import { SettingsCard } from "../components/settings-card";
import { PdfSurface } from "../components/documents/doc-panel";
import { ManagedTable } from "../components/table/managed-table";
import { builtInLayout, type TableCatalogue } from "../lib/list-views";
import { APPROVAL_PILL } from "../lib/approvals";
import { formatLongDateTime, formatFileSize } from "../lib/format";
import { Input } from "../components/ui/input";
import { CONTROL_CLASS } from "../lib/form-controls";

export async function portalApprovalsLoader({ request, params }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/login");
  const url = new URL(request.url);
  const status = url.searchParams.get("status") === "completed" ? "completed" : "pending";
  if (params.id) {
    const packet = await api.GET("/api/v1/portal/approvals/{id}", {
      params: { path: { id: params.id } },
    });
    if (!packet.data)
      throw new Response("This approval request is unavailable.", {
        status: packet.response.status,
      });
    return { user, status, query: "", packet: packet.data, list: null };
  }
  const list = await api.GET("/api/v1/portal/approvals", {
    params: {
      query: {
        status,
        q: url.searchParams.get("q") || undefined,
        before: url.searchParams.get("before") ?? undefined,
      },
    },
  });
  if (!list.data) throw new Error("Your approvals could not be read.");
  return { user, status, query: url.searchParams.get("q") ?? "", packet: null, list: list.data };
}

type ApprovalRow =
  paths["/api/v1/portal/approvals"]["get"]["responses"][200]["content"]["application/json"]["approvals"][number];
function ApprovalStatus({ status }: { status: ApprovalRow["status"] }) {
  const Icon = status === "pending" ? Clock3 : status === "approved" ? Check : X;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs font-medium ${APPROVAL_PILL[status]}`}
    >
      <Icon size={12} aria-hidden="true" />
      {status === "pending" ? (
        <FormattedMessage id="portal.approvals.pending" defaultMessage="Pending" />
      ) : status === "approved" ? (
        <FormattedMessage id="portal.approvals.approved" defaultMessage="Approved" />
      ) : (
        <FormattedMessage id="portal.approvals.rejected" defaultMessage="Rejected" />
      )}
    </span>
  );
}
const catalogue: TableCatalogue<ApprovalRow> = {
  flexColumnKey: "contract",
  defaultColumnKeys: ["contract", "requestedBy", "requestedAt", "status"],
  columns: [
    {
      key: "contract",
      header: <FormattedMessage id="portal.approvals.contract" defaultMessage="Contract" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.approvals.contract", defaultMessage: "Contract" }),
      defaultWidth: 400,
      minWidth: 240,
      render: (row) => (
        <Link className="font-medium text-link" to={`/portal/approvals/${row.id}`}>
          <span className="me-3 font-normal text-muted">C-{row.contractNumber}</span>
          {row.contractTitle}
        </Link>
      ),
    },
    {
      key: "requestedBy",
      header: <FormattedMessage id="portal.approvals.requester" defaultMessage="Requested by" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.approvals.requester", defaultMessage: "Requested by" }),
      defaultWidth: 240,
      minWidth: 180,
      render: (row) => (
        <span className="flex items-center gap-2">
          <Avatar name={row.requestedBy} className="size-6" />
          {row.requestedBy}
        </span>
      ),
    },
    {
      key: "requestedAt",
      header: <FormattedMessage id="portal.approvals.requestedDate" defaultMessage="Requested" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.approvals.requestedDate", defaultMessage: "Requested" }),
      defaultWidth: 200,
      minWidth: 160,
      render: (row) => <span className="text-muted">{formatLongDateTime(row.requestedAt)}</span>,
    },
    {
      key: "status",
      header: <FormattedMessage id="portal.approvals.status" defaultMessage="Status" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.approvals.status", defaultMessage: "Status" }),
      defaultWidth: 130,
      minWidth: 110,
      render: (row) => <ApprovalStatus status={row.status} />,
    },
  ],
};

export function PortalApprovalsPage() {
  const { user, status, query, packet, list } = useLoaderData<typeof portalApprovalsLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const signOut = useSignOut("/portal/login");
  const revalidator = useRevalidator();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(query);
  const [layout, setLayout] = useState(() => builtInLayout(catalogue));
  const [error, setError] = useState<string>();
  const title = intl.formatMessage({
    id: "portal.navigation.approvals",
    defaultMessage: "Approvals",
  });
  const [previousQuery, setPreviousQuery] = useState(query);
  if (previousQuery !== query) {
    setPreviousQuery(query);
    setSearch(query);
  }
  useEffect(() => {
    if (packet?.document?.preview !== "pending") return;
    const timer = setInterval(() => {
      void revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [packet?.document?.preview, revalidator]);
  async function decide(decision: "approved" | "rejected") {
    if (!packet || busy) return;
    setBusy(true);
    setError(undefined);
    const result = await api
      .POST("/api/v1/portal/approvals/{id}/decision", {
        params: { path: { id: packet.approval.id } },
        body: { decision, note: note.trim() || undefined },
      })
      .catch(() => undefined);
    if (result?.data) {
      setNote("");
      await revalidator.revalidate();
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "portal.approvals.failed",
            defaultMessage: "Your decision could not be saved. Please try again.",
          }),
      );
    setBusy(false);
  }
  const listUrl = (nextStatus: string, q = query, before?: string) =>
    `/portal/approvals?${new URLSearchParams({ status: nextStatus, ...(q ? { q } : {}), ...(before ? { before } : {}) })}`;
  return (
    <PortalShell wide user={user} onSignOut={() => void signOut()}>
      <PageTitle title={packet?.approval.contractTitle ?? title} />
      {packet ? (
        <>
          <Link
            to="/portal/approvals"
            className="flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:text-primary"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <FormattedMessage id="portal.approvals.back" defaultMessage="All approvals" />
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm text-muted">C-{packet.approval.contractNumber}</p>
              <h1 className="text-2xl font-semibold">{packet.approval.contractTitle}</h1>
            </div>
            <ApprovalStatus status={packet.approval.status} />
          </div>
          <div className="grid min-w-0 grid-cols-1 items-start gap-6 @4xl/page:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 overflow-hidden rounded-card border border-border-default bg-raised">
              <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText size={16} className="shrink-0 text-muted" aria-hidden="true" />
                  <h2 className="truncate text-base font-semibold">
                    {packet.document?.filename ??
                      intl.formatMessage({
                        id: "portal.approvals.document",
                        defaultMessage: "Primary document",
                      })}
                  </h2>
                </div>
                {packet.document && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={packet.document.downloadUrl} download>
                      <Download size={16} aria-hidden="true" />
                      <FormattedMessage
                        id="portal.approvals.downloadAction"
                        defaultMessage="Download"
                      />
                    </a>
                  </Button>
                )}
              </div>
              {packet.document?.preview === "pdf" ? (
                <div className="h-[min(70dvh,56rem)] min-h-80">
                  <PdfSurface
                    src={packet.document.previewUrl}
                    filename={packet.document.filename}
                  />
                </div>
              ) : packet.document?.preview === "image" ? (
                <div className="flex min-h-80 justify-center bg-canvas p-6">
                  <img
                    src={packet.document.previewUrl}
                    alt={packet.document.filename}
                    className="max-h-[70dvh] max-w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
                  <FileText size={32} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
                  <h3 className="text-base font-semibold">
                    {packet.document?.preview === "pending" ? (
                      <FormattedMessage
                        id="portal.approvals.preparing"
                        defaultMessage="Preparing document preview"
                      />
                    ) : packet.document ? (
                      <FormattedMessage
                        id="portal.approvals.downloadToReview"
                        defaultMessage="Download the document to review it"
                      />
                    ) : (
                      <FormattedMessage
                        id="portal.approvals.noDocumentTitle"
                        defaultMessage="No document attached"
                      />
                    )}
                  </h3>
                  <p className="max-w-sm text-sm text-muted">
                    {packet.document ? (
                      formatFileSize(packet.document.byteSize)
                    ) : (
                      <FormattedMessage
                        id="portal.approvals.noDocument"
                        defaultMessage="No primary document is available. Contact the requester if you need a document to review."
                      />
                    )}
                  </p>
                  {packet.document && (
                    <Button asChild variant="secondary">
                      <a href={packet.document.downloadUrl} download>
                        <Download size={16} aria-hidden="true" />
                        <FormattedMessage
                          id="portal.approvals.downloadAction"
                          defaultMessage="Download"
                        />
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </section>
            <div className="flex min-w-0 flex-col gap-4">
              <SettingsCard
                title={
                  <FormattedMessage
                    id="portal.approvals.requestDetails"
                    defaultMessage="Approval request"
                  />
                }
              >
                <div className="flex items-center gap-3">
                  <Avatar name={packet.approval.requestedBy} />
                  <div className="min-w-0">
                    <p className="text-xs text-muted">
                      <FormattedMessage
                        id="portal.approvals.requester"
                        defaultMessage="Requested by"
                      />
                    </p>
                    <p className="text-base font-medium">{packet.approval.requestedBy}</p>
                  </div>
                </div>
                <dl className="space-y-1">
                  <dt className="text-xs text-muted">
                    <FormattedMessage
                      id="portal.approvals.requestedDate"
                      defaultMessage="Requested"
                    />
                  </dt>
                  <dd className="text-sm">{formatLongDateTime(packet.approval.requestedAt)}</dd>
                </dl>
              </SettingsCard>
              <SettingsCard
                title={
                  <FormattedMessage
                    id="portal.approvals.yourDecision"
                    defaultMessage="Your decision"
                  />
                }
              >
                {packet.approval.status === "pending" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="approval-note">
                        <FormattedMessage
                          id="portal.approvals.note"
                          defaultMessage="Note (optional)"
                        />
                      </Label>
                      <textarea
                        id="approval-note"
                        className={`${CONTROL_CLASS} min-h-28 w-full resize-y`}
                        maxLength={MAX_APPROVAL_NOTE_LENGTH}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        disabled={busy}
                      />
                    </div>
                    {error && (
                      <p role="alert" className="text-sm text-status-danger-fg">
                        {error}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void decide("rejected")}
                      >
                        <X size={14} aria-hidden="true" />
                        <FormattedMessage id="portal.approvals.reject" defaultMessage="Reject" />
                      </Button>
                      <Button disabled={busy} onClick={() => void decide("approved")}>
                        <Check size={14} aria-hidden="true" />
                        <FormattedMessage id="portal.approvals.approve" defaultMessage="Approve" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div role="status">
                      <ApprovalStatus status={packet.approval.status} />
                    </div>
                    {packet.approval.decidedAt && (
                      <p className="text-sm text-muted">
                        {formatLongDateTime(packet.approval.decidedAt)}
                      </p>
                    )}
                    {packet.approval.note && (
                      <p className="whitespace-pre-wrap text-base">{packet.approval.note}</p>
                    )}
                  </>
                )}
              </SettingsCard>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              <FormattedMessage id="portal.approvals.title" defaultMessage="Your approvals" />
            </h1>
            <p className="text-base text-muted">
              <FormattedMessage
                id="portal.approvals.description"
                defaultMessage="Review Contracts awaiting your sign-off and revisit your decisions."
              />
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <nav
              aria-label={title}
              className="flex gap-1 rounded-button border border-border-default bg-control p-1"
            >
              {(["pending", "completed"] as const).map((tab) => (
                <Link
                  key={tab}
                  to={listUrl(tab)}
                  aria-current={status === tab ? "page" : undefined}
                  className={`rounded-button px-3 py-1.5 text-sm font-medium ${status === tab ? "bg-raised text-primary shadow-sm" : "text-muted hover:text-primary"}`}
                >
                  {tab === "pending" ? (
                    <FormattedMessage id="portal.approvals.pending" defaultMessage="Pending" />
                  ) : (
                    <FormattedMessage id="portal.approvals.completed" defaultMessage="Completed" />
                  )}
                </Link>
              ))}
            </nav>
            <form
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                void navigate(listUrl(status, search.trim()));
              }}
              className="flex w-full items-center gap-2 @sm/page:w-auto"
            >
              <div className="relative min-w-0 flex-1">
                <Search
                  size={16}
                  className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <Input
                  className="w-full ps-8 @sm/page:w-72"
                  type="search"
                  aria-label={intl.formatMessage({
                    id: "portal.approvals.search",
                    defaultMessage: "Search approvals",
                  })}
                  placeholder={intl.formatMessage({
                    id: "portal.approvals.search",
                    defaultMessage: "Search approvals",
                  })}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Button variant="secondary" type="submit">
                <FormattedMessage id="portal.approvals.searchAction" defaultMessage="Search" />
              </Button>
            </form>
          </div>
          {list?.approvals.length ? (
            <ManagedTable
              catalogue={catalogue}
              layout={layout}
              onLayoutChange={setLayout}
              rows={list.approvals}
              rowKey={(row) => row.id}
              onRowActivate={(row) => void navigate(`/portal/approvals/${row.id}`)}
              foot={
                list.nextCursor ? (
                  <Button asChild variant="secondary">
                    <Link to={listUrl(status, query, list.nextCursor)}>
                      <FormattedMessage id="portal.approvals.more" defaultMessage="Next page" />
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
              <CheckCheck size={32} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
              <h2 className="text-lg font-semibold">
                {query ? (
                  <FormattedMessage
                    id="portal.approvals.noMatches"
                    defaultMessage="No matching approvals"
                  />
                ) : status === "pending" ? (
                  <FormattedMessage
                    id="portal.approvals.nonePending"
                    defaultMessage="You're all caught up"
                  />
                ) : (
                  <FormattedMessage
                    id="portal.approvals.noneCompleted"
                    defaultMessage="No completed approvals yet"
                  />
                )}
              </h2>
              <p className="max-w-sm text-base text-muted">
                {query ? (
                  <FormattedMessage
                    id="portal.approvals.trySearch"
                    defaultMessage="Try a different Contract title or requester name."
                  />
                ) : (
                  <FormattedMessage
                    id="portal.approvals.emptyHelp"
                    defaultMessage="When someone asks for your approval, the request will appear here."
                  />
                )}
              </p>
            </div>
          )}
        </>
      )}
    </PortalShell>
  );
}
