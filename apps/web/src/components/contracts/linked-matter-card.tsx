// SPDX-License-Identifier: AGPL-3.0-only

/** The Contract record's MTR-007 linked-Matter context. */
import { useState } from "react";
import { useRecord } from "../record-context";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { matterReference, MATTER_STATUS_PILL } from "../../lib/matters";
import { unlinkContractMatter, type LinkedMatter } from "../../lib/contract-matters";
import { Button } from "../ui/button";
import { ContractMatterLinkDialog } from "./contract-matter-link-dialog";

export function LinkedMatterCard({
  matter,
  onMatter,
}: Readonly<{
  matter: LinkedMatter;
  onMatter: (matter: LinkedMatter) => void;
}>) {
  const { record, confidential: contractIsConfidential, frozen } = useRecord();
  const contractNumber = record.number;
  const editable = !frozen;
  const intl = useIntl();
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlink() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await unlinkContractMatter(contractNumber);
    setBusy(false);
    if (result.ok) onMatter(null);
    else {
      setError(
        result.detail ??
          intl.formatMessage({
            id: "contractMatter.unlink.error",
            defaultMessage: "The Contract could not be unlinked from the Matter.",
          }),
      );
    }
  }

  return (
    <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex min-h-section-header flex-wrap items-center justify-between gap-2 border-b border-border-default bg-section-header px-4 py-2">
        <h2 className="text-base font-semibold">
          <FormattedMessage id="contractMatter.matter.heading" defaultMessage="Matter" />
        </h2>
        {editable && matter === null && (
          <Button variant="secondary" onClick={() => setLinking(true)}>
            <FormattedMessage id="contractMatter.linkMatter" defaultMessage="Link to Matter" />
          </Button>
        )}
      </header>
      <div className="p-4">
        {matter === null ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contractMatter.standalone"
              defaultMessage="Standalone Contract — no broader Matter is linked."
            />
          </p>
        ) : matter.restricted ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contractMatter.restrictedMatter"
              defaultMessage="Restricted matter"
            />
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3 @sm/record:flex-row @sm/record:items-center">
            <Link
              to={`/matters/${matter.number}`}
              className="min-w-0 break-words text-sm text-link hover:underline"
            >
              {matterReference(intl, matter.number)} {matter.title}
            </Link>
            <span
              className={`w-fit shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${MATTER_STATUS_PILL[matter.statusCategory]}`}
            >
              {matter.statusName}
            </span>
            {editable && (
              <Button
                className="@sm/record:ml-auto"
                variant="secondary"
                disabled={busy}
                onClick={() => void unlink()}
              >
                <FormattedMessage id="contractMatter.unlink" defaultMessage="Unlink" />
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
      </div>
      {linking && (
        <ContractMatterLinkDialog
          mode="from-contract"
          contractNumber={contractNumber}
          anchorIsConfidential={contractIsConfidential}
          onClose={() => setLinking(false)}
          onLinked={onMatter}
        />
      )}
    </section>
  );
}
