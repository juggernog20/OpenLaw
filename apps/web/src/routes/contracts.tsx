// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts destination (M8/1), reduced to what the contract record
 * core carries: the list (reference, title, type, status — ordered
 * newest reference first by the API, each row opening its record page
 * at `/contracts/<number>`), the create dialog that takes a title and a
 * type, an empty state that says what the module is, and the
 * show-archived toggle with a row-level restore. Owner, primary
 * counterparty, and value join the list with the tickets that add
 * those columns to the record. The loader is the client half of the
 * Member+ gate; the API's 403 is the real refusal.
 */

import { useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { FileText, Plus, Signature } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  contractReference,
  STAGE_PILL,
  type ContractRow,
  type ContractTypeOption,
} from "../lib/contracts";
import { CONTROL_CLASS } from "../lib/form-controls";
import { problemDetail } from "../lib/messages";
import { isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function contractsLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // Member+ only: Contributors and Business Users get no surface at
  // all, not a disabled one. The API's 403 stands behind this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const [list, options] = await Promise.all([
    api.GET("/api/v1/contracts"),
    api.GET("/api/v1/contracts/options"),
  ]);
  if (!list.data || !options.data) throw new Error("The contract list could not be read.");
  return { user, contracts: list.data.contracts, contractTypes: options.data.contractTypes };
}

export function ContractsPage() {
  const { user, contracts, contractTypes } = useLoaderData<typeof contractsLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ContractRow[]>(contracts);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  /** One list-level request at a time: a second toggle or restore
   * launched mid-flight would race the first, and the loser's answer
   * would overwrite the winner's list. */
  const [listBusy, setListBusy] = useState(false);

  /** The working list — archived rows never count, whichever view is
   * showing (they are mistakes, not contracts). */
  const liveCount = rows.filter((row) => row.archivedAt === null).length;

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  /** The toggle re-reads either way: archived rows only exist
   * server-side, and coming back should not trust a stale list either. */
  async function toggleArchived(next: boolean) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data } = await api
      .GET(
        "/api/v1/contracts",
        next ? { params: { query: { includeArchived: "true" as const } } } : {},
      )
      .catch(() => ({ data: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "contracts.listError",
          defaultMessage: "The contract list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.contracts);
    setShowArchived(next);
  }

  /** Row-level restore, offered in the archived view — archiving is for
   * mistakes, so the way back sits where the mistake surfaces. */
  async function restoreRow(row: ContractRow) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data, error } = await api
      .POST("/api/v1/contracts/{number}/restore", { params: { path: { number: row.number } } })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        problemDetail(error) ??
          intl.formatMessage({
            id: "contracts.restoreError",
            defaultMessage: "The contract could not be restored.",
          }),
      );
      return;
    }
    const restored = data.contract;
    setRows((current) => current.map((existing) => (existing.id === row.id ? restored : existing)));
  }

  const createButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
    </Button>
  );

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="contracts.title" defaultMessage="Contracts" />}
          subtitle={
            <FormattedMessage
              id="contracts.count"
              defaultMessage="{count, plural, one {# contract} other {# contracts}}"
              values={{ count: liveCount }}
            />
          }
          primaryAction={createButton}
        />
      }
    >
      <PageTitle
        title={intl.formatMessage({ id: "contracts.title", defaultMessage: "Contracts" })}
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          {listError && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {listError}
            </p>
          )}
          <Label htmlFor="contracts-show-archived">
            <FormattedMessage id="contracts.showArchived" defaultMessage="Show archived" />
          </Label>
          <Switch
            id="contracts-show-archived"
            checked={showArchived}
            disabled={listBusy}
            onCheckedChange={(next) => void toggleArchived(next)}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyContracts onCreate={() => setCreateOpen(true)} />
        ) : (
          <ContractsTable
            rows={rows}
            showArchived={showArchived}
            busy={listBusy}
            onRestore={(row) => void restoreRow(row)}
          />
        )}
      </div>
      {createOpen && (
        <CreateContractDialog
          contractTypes={contractTypes}
          onOpenChange={setCreateOpen}
          onCreated={(row) => setRows((current) => [row, ...current])}
        />
      )}
    </AppShell>
  );
}

/** The module's pitch, for the first visit. */
function EmptyContracts({ onCreate }: Readonly<{ onCreate: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      <Signature size={24} aria-hidden="true" className="text-subtle" />
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">
          <FormattedMessage id="contracts.empty.title" defaultMessage="No contracts yet" />
        </h2>
        <p className="max-w-md text-base text-muted">
          <FormattedMessage
            id="contracts.empty.body"
            defaultMessage={
              "A contract is the workspace for work that ends in a signed " +
              "document. Create one when a deal starts; it takes a reference " +
              "you can quote in email."
            }
          />
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus size={16} aria-hidden="true" />
        <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
      </Button>
    </div>
  );
}

/** The list, reduced to the columns the record core carries. The API
 * orders the rows; this renders them. The archived view adds an
 * Archived pill and a row-level restore. */
function ContractsTable({
  rows,
  showArchived,
  busy,
  onRestore,
}: Readonly<{
  rows: ContractRow[];
  showArchived: boolean;
  /** A list-level request is in flight; row actions stand down. */
  busy: boolean;
  onRestore: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  return (
    <div className="overflow-x-auto rounded-card border border-border-default bg-raised">
      <table className="w-full">
        <thead>
          <tr className="bg-section-header text-start text-sm font-medium text-muted">
            <th scope="col" className="w-24 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.reference" defaultMessage="Reference" />
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.title" defaultMessage="Title" />
            </th>
            <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.type" defaultMessage="Type" />
            </th>
            <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.status" defaultMessage="Status" />
            </th>
            {showArchived && (
              <th scope="col" className="w-24 px-4 py-2 text-end font-medium">
                <span className="sr-only">
                  <FormattedMessage id="contracts.column.actions" defaultMessage="Actions" />
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border-default">
              <td className="px-4 py-2.5 text-sm text-muted">
                {contractReference(intl, row.number)}
              </td>
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  <Link
                    to={`/contracts/${row.number}`}
                    className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                  >
                    {row.title}
                  </Link>
                  {row.archivedAt !== null && (
                    <span className="inline-flex rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                      <FormattedMessage id="contracts.archivedPill" defaultMessage="Archived" />
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm text-muted">{row.contractTypeName}</td>
              <td className="px-4 py-2.5">
                <span
                  className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[row.stage]}`}
                >
                  {row.statusName}
                </span>
              </td>
              {showArchived && (
                <td className="px-4 py-2.5 text-end">
                  {row.archivedAt !== null && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      aria-label={intl.formatMessage(
                        { id: "contracts.restoreRow", defaultMessage: "Restore {title}" },
                        { title: row.title },
                      )}
                      onClick={() => onRestore(row)}
                    >
                      <FormattedMessage id="contracts.record.restore" defaultMessage="Restore" />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Creation is deliberately minimal: a title and a type. The status
 * starts on the protected draft seed, and everything else is set inline
 * on the record afterward (DES-017). */
function CreateContractDialog({
  contractTypes,
  onOpenChange,
  onCreated,
}: Readonly<{
  contractTypes: ContractTypeOption[];
  onOpenChange: (open: boolean) => void;
  onCreated: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  const [title, setTitle] = useState("");
  const [contractTypeId, setContractTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    if (title.trim() === "") {
      setError(
        intl.formatMessage({
          id: "contracts.form.titleMissing",
          defaultMessage: "Name the contract.",
        }),
      );
      return;
    }
    if (contractTypeId === "") {
      setError(
        intl.formatMessage({
          id: "contracts.form.typeMissing",
          defaultMessage: "Pick a contract type.",
        }),
      );
      return;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/contracts", { body: { title: title.trim(), contractTypeId } })
      .catch(() => ({ data: null, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.form.createError",
            defaultMessage: "The contract could not be created.",
          }),
      );
      return;
    }
    onCreated(data.contract);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="contracts.form.title" defaultMessage="Create contract" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-title">
              <FormattedMessage id="contracts.form.titleField" defaultMessage="Title" />
            </Label>
            <Input
              id="contract-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-type">
              <FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />
            </Label>
            <select
              id="contract-type"
              value={contractTypeId}
              className={CONTROL_CLASS}
              onChange={(event) => {
                setContractTypeId(event.target.value);
                // Picking a type answers the pick-a-type refusal.
                if (event.target.value !== "") setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({
                  id: "contracts.form.typePlaceholder",
                  defaultMessage: "Type…",
                })}
              </option>
              {contractTypes.map((contractType) => (
                <option key={contractType.id} value={contractType.id}>
                  {contractType.displayName}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contracts.form.draftNote"
              defaultMessage="New contracts start in Draft. Set everything else on the record."
            />
          </p>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="contracts.form.submit" defaultMessage="Create" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
