// SPDX-License-Identifier: AGPL-3.0-only

/** The Matter record's linked-Contracts section, read from contracts.matter_id. */
import { useState } from "react";
import { useRecord } from "../record-context";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { contractReference, STAGE_PILL } from "../../lib/contracts";
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
}: Readonly<{
  contracts: LinkedContract[];
  onContracts: (contracts: LinkedContract[]) => void;
}>) {
  const { record, confidential: matterIsConfidential, frozen } = useRecord();
  const matterNumber = record.number;
  const editable = !frozen;
  const intl = useIntl();
  const [linking, setLinking] = useState(false);
  const [busyNumber, setBusyNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <Button variant="secondary" onClick={() => setLinking(true)}>
            <FormattedMessage id="contractMatter.linkContract" defaultMessage="Link Contract" />
          </Button>
        )}
      </header>
      <div className="p-4">
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
                <li key={`restricted-${index}`} className="py-3">
                  <RestrictedRecordCell
                    label={{
                      id: "contractMatter.restrictedContract",
                      defaultMessage: "Restricted contract",
                    }}
                  />
                </li>
              ) : (
                <li
                  key={contract.number}
                  className="flex min-w-0 flex-col gap-2 py-3 @sm/record:flex-row @sm/record:items-center"
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
          <p role="alert" className="mt-2 text-xs text-status-danger-fg">
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
    </section>
  );
}
