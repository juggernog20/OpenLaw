// SPDX-License-Identifier: AGPL-3.0-only

/** The Matter record's linked-Contracts section, read from contracts.matter_id. */
import { useState } from "react";
import { useRecord } from "../record-context";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import {
  contractReference,
  STAGE_PILL,
  type ContractTypeOption,
  type UserOption,
} from "../../lib/contracts";
import { api } from "../../lib/api";
import { readRegistry } from "../../lib/entities";
import type { FieldReference } from "../custom-field-control";
import { CreateContractDialog } from "../contracts/create-contract-dialog";
import {
  readMatterContracts,
  unlinkContractMatter,
  type LinkedContract,
} from "../../lib/contract-matters";
import { Button } from "../ui/button";
import { RestrictedRecordCell } from "../restricted-record-cell";
import { ContractMatterLinkDialog } from "../contracts/contract-matter-link-dialog";

export function LinkedContractsCard({
  contracts,
  onContracts,
  matterTitle,
}: Readonly<{
  contracts: LinkedContract[];
  onContracts: (contracts: LinkedContract[]) => void;
  matterTitle: string;
}>) {
  const { record, viewer, confidential: matterIsConfidential, frozen } = useRecord();
  const matterNumber = record.number;
  const editable = !frozen;
  const intl = useIntl();
  const [linking, setLinking] = useState(false);
  const [busyNumber, setBusyNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [createOptions, setCreateOptions] = useState<{
    contractTypes: ContractTypeOption[];
    users: UserOption[];
    entities: FieldReference[];
  } | null>(null);

  async function openCreate() {
    if (loadingCreate) return;
    setLoadingCreate(true);
    setError(null);
    const [options, registry] = await Promise.all([
      api.GET("/api/v1/contracts/options").catch(() => undefined),
      readRegistry().catch(() => undefined),
    ]);
    if (options?.data && registry?.data) {
      setCreateOptions({
        contractTypes: options.data.contractTypes,
        users: options.data.users,
        entities: registry.data.entities.map((entity) => ({
          id: entity.id,
          label: entity.legalName,
        })),
      });
    } else {
      setError(
        intl.formatMessage({
          id: "contractMatter.createOptions.error",
          defaultMessage: "The contract form could not be loaded. Try New contract again.",
        }),
      );
    }
    setLoadingCreate(false);
  }

  async function refresh() {
    const result = await readMatterContracts(matterNumber);
    if (result.ok) onContracts(result.contracts);
    else {
      setError(
        intl.formatMessage({
          id: "contractMatter.refresh.error",
          defaultMessage: "The linked Contracts could not be refreshed.",
        }),
      );
    }
  }

  async function unlink(number: number) {
    if (busyNumber !== null) return;
    setBusyNumber(number);
    setError(null);
    const result = await unlinkContractMatter(number);
    if (result.ok) await refresh();
    else {
      setError(
        result.detail ??
          intl.formatMessage({
            id: "contractMatter.unlink.error",
            defaultMessage: "The Contract could not be unlinked from the Matter.",
          }),
      );
    }
    setBusyNumber(null);
  }

  return (
    <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex min-h-section-header flex-wrap items-center justify-between gap-2 border-b border-border-default bg-section-header px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
            <FormattedMessage
              id="contractMatter.contracts.heading"
              defaultMessage="Linked Contracts"
            />
          </h2>
          <span className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg">
            {contracts.length}
          </span>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={loadingCreate} onClick={() => void openCreate()}>
              <FormattedMessage id="contractMatter.newContract" defaultMessage="New contract" />
            </Button>
            <Button variant="secondary" onClick={() => setLinking(true)}>
              <FormattedMessage id="contractMatter.linkContract" defaultMessage="Link Contract" />
            </Button>
          </div>
        )}
      </header>
      <div className={contracts.length === 0 ? "p-4" : "px-4"}>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contractMatter.contracts.empty"
              defaultMessage="No Contracts are linked to this Matter."
            />
          </p>
        ) : (
          <ul className="divide-y divide-border-default">
            {contracts.map((contract, index) =>
              contract.restricted ? (
                <RestrictedRecordCell
                  key={`restricted-${index}`}
                  as="li"
                  className="py-2"
                  label={{
                    id: "contractMatter.restrictedContract",
                    defaultMessage: "Restricted contract",
                  }}
                />
              ) : (
                <li
                  key={contract.number}
                  className="flex min-w-0 flex-col gap-2 py-2 @sm/record:flex-row @sm/record:items-center"
                >
                  <Link
                    to={`/contracts/${contract.number}`}
                    className="min-w-0 break-words text-sm text-link hover:underline"
                  >
                    {contractReference(intl, contract.number)} {contract.title}
                  </Link>
                  <span
                    className={`w-fit shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[contract.stage]}`}
                  >
                    {contract.statusName}
                  </span>
                  {editable && (
                    <Button
                      className="@sm/record:ml-auto"
                      variant="secondary"
                      disabled={busyNumber !== null}
                      onClick={() => void unlink(contract.number)}
                    >
                      <FormattedMessage id="contractMatter.unlink" defaultMessage="Unlink" />
                    </Button>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
        {error && (
          <p role="alert" className="my-2 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
      </div>
      {linking && (
        <ContractMatterLinkDialog
          mode="from-matter"
          matterNumber={matterNumber}
          anchorIsConfidential={matterIsConfidential}
          onClose={() => setLinking(false)}
          onLinked={() => void refresh()}
        />
      )}
      {createOptions && editable && (
        <CreateContractDialog
          {...createOptions}
          viewerId={viewer.id}
          initialMatter={{
            number: matterNumber,
            title: matterTitle,
            isConfidential: matterIsConfidential,
          }}
          onOpenChange={(open) => {
            if (!open) setCreateOptions(null);
          }}
          onCreated={() => {
            setCreateOptions(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
