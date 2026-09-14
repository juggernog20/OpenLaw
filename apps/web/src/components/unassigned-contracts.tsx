// SPDX-License-Identifier: AGPL-3.0-only

/** Browse generated contracts and assign their Legal Owners from the Inbox. */
import { useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { contractReference } from "../lib/contracts";
import { builtInLayout } from "../lib/list-views";
import { ManagedTable } from "./table/managed-table";
import { Dialog } from "./ui/dialog";
import {
  UNASSIGNED_CONTRACTS_CATALOGUE,
  type UnassignedContract,
} from "./inbox/unassigned-contracts-columns";
import { ContractAssignmentDialog } from "./inbox/contract-assignment-dialog";
import { Button } from "./ui/button";

export type UnassignedContracts =
  paths["/api/v1/inbox/unassigned-contracts"]["get"]["responses"][200]["content"]["application/json"];
export function UnassignedContractsPanel({
  queue,
  onChange,
}: {
  queue: UnassignedContracts;
  onChange: (queue: UnassignedContracts) => void;
}) {
  const intl = useIntl();
  const [layout, setLayout] = useState(() => builtInLayout(UNASSIGNED_CONTRACTS_CATALOGUE));
  const [assigning, setAssigning] = useState<UnassignedContract | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refused = () =>
    intl.formatMessage({
      id: "inbox.unassignedRefused",
      defaultMessage: "The unassigned Contracts could not be updated. Try again.",
    });
  async function assign(number: number, legalOwnerId: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.POST("/api/v1/inbox/unassigned-contracts/{number}/assign", {
        params: { path: { number } },
        body: { legalOwnerId },
      });
      if (result.data) {
        onChange({
          ...queue,
          contracts: queue.contracts.filter((row) => row.number !== number),
          total: Math.max(0, queue.total - 1),
        });
        setAssigning(null);
        return;
      }
      if (result.response.status === 409 || result.response.status === 404) {
        const refreshed = await api.GET("/api/v1/inbox/unassigned-contracts");
        if (refreshed.data) onChange(refreshed.data);
        setAssigning(null);
      }
      throw new Error(result.error?.detail ?? refused());
    } catch (error) {
      setError(error instanceof Error ? error.message : refused());
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function more() {
    if (queue.nextCursor === null) return;
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await api.GET("/api/v1/inbox/unassigned-contracts", {
        params: { query: { cursor: queue.nextCursor } },
      });
      if (!data) throw new Error(refused());
      onChange({
        ...data,
        contracts: [
          ...queue.contracts,
          ...data.contracts.filter(
            (row) => !queue.contracts.some((existing) => existing.id === row.id),
          ),
        ],
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : refused());
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={intl.formatMessage({
        id: "inbox.unassignedContracts",
        defaultMessage: "Unassigned contracts",
      })}
      className="space-y-3"
    >
      {error && !assigning && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
      {!queue.contracts.length ? (
        <div className="rounded-card border border-border-default bg-raised p-12 text-center">
          <h2 className="font-semibold">
            <FormattedMessage
              id="inbox.noUnassigned"
              defaultMessage="No generated contracts need a Legal Owner"
            />
          </h2>
          <p className="mt-2 text-sm text-muted">
            <FormattedMessage
              id="inbox.noUnassignedHelp"
              defaultMessage="Contracts created through Auto-Docs without a Legal Owner appear here. Assign them to a legal colleague."
            />
          </p>
        </div>
      ) : (
        <ManagedTable
          catalogue={UNASSIGNED_CONTRACTS_CATALOGUE}
          layout={layout}
          rows={queue.contracts}
          rowKey={(row) => row.id}
          onLayoutChange={setLayout}
          actionsColumn={{
            label: intl.formatMessage({ id: "inbox.column.actions", defaultMessage: "Actions" }),
            width: 128,
            pinned: true,
            render: (row) => (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                aria-label={intl.formatMessage(
                  { id: "inbox.assignRow", defaultMessage: "Assign {reference}" },
                  { reference: contractReference(intl, row.number) },
                )}
                onClick={() => {
                  setError(undefined);
                  setAssigning(row);
                }}
              >
                <UserPlus size={16} aria-hidden="true" />
                <FormattedMessage id="inbox.assign" defaultMessage="Assign" />
              </Button>
            ),
          }}
        />
      )}
      {queue.nextCursor !== null && (
        <Button variant="secondary" disabled={busy} onClick={() => void more()}>
          <FormattedMessage id="inbox.more" defaultMessage="Show more" />
        </Button>
      )}
      <Dialog
        open={assigning !== null}
        onOpenChange={(open) => {
          if (!open && !pending.current) setAssigning(null);
        }}
      >
        {assigning && (
          <ContractAssignmentDialog
            key={assigning.id}
            row={assigning}
            busy={busy}
            error={error}
            onAssign={(ownerId) => void assign(assigning.number, ownerId)}
            onClose={() => setAssigning(null)}
          />
        )}
      </Dialog>
    </section>
  );
}
