// SPDX-License-Identifier: AGPL-3.0-only

/** The Contract record's CTR-008 review pieces: the inline Unverified
 * marker, its confirmation control, and the run controls and run note
 * the Fields section header carries. */

import { useState, type ReactNode } from "react";
import { CircleAlert, Sparkles } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { ContractAnalysis, ContractRow } from "../../lib/contracts";
import { Button } from "../ui/button";

export function UnverifiedMarker() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-status-neutral-bg px-1.5 py-0.5 text-xs font-medium text-status-neutral-fg">
      <CircleAlert size={12} aria-hidden="true" />
      <FormattedMessage id="contracts.analysis.unverified" defaultMessage="Unverified" />
    </span>
  );
}

/** One confirmation control owns its progress and refusal in the field's micro-state slot. */
export function ConfirmUnverified({
  onConfirm,
  label,
  variant = "link",
}: Readonly<{
  onConfirm: () => Promise<string | undefined>;
  label?: ReactNode;
  /** The field row keeps the link; a panel foot takes the bordered control. */
  variant?: "link" | "secondary";
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const refusal = await onConfirm().finally(() => setBusy(false));
    setError(refusal);
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={busy}
        onClick={() => void confirm()}
      >
        {label ?? <FormattedMessage id="contracts.analysis.confirm" defaultMessage="Confirm" />}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-status-danger-fg">
          {error}
        </span>
      )}
    </span>
  );
}

/** Does this record have an analysis story to tell at all? A record
 * with no connector, no run and no flagged value says nothing. */
function analysisSilent(analysis: ContractAnalysis, contract: ContractRow): boolean {
  return (
    !analysis.available &&
    Object.keys(contract.aiUnverified ?? {}).length === 0 &&
    !analysis.latestRun
  );
}

/** The run controls, for the Fields section header (DES-075 amendment,
 * 2026-09-22). The run belongs to the field scope the section defines,
 * so its controls sit in that section's header rather than in a card of
 * their own. */
export function AnalysisRunActions({
  analysis,
  contract,
  canRun,
  canConfirm,
  running,
  onRun,
  onRetry,
  onConfirmAll,
}: Readonly<{
  analysis: ContractAnalysis;
  contract: ContractRow;
  canRun: boolean;
  canConfirm: boolean;
  /** The page owns the run's progress and refusal: the overflow menu
   * starts the same run, and its refusal has to land here too. */
  running: boolean;
  onRun: () => void;
  onRetry?: () => void;
  onConfirmAll: () => Promise<string | undefined>;
}>) {
  const flagged = Object.keys(contract.aiUnverified ?? {});
  if (analysisSilent(analysis, contract)) return null;
  return (
    <>
      {canRun &&
        analysis.latestRun?.trigger === "conversion" &&
        analysis.latestRun.state === "failed" &&
        onRetry && (
          <Button type="button" variant="secondary" size="sm" disabled={running} onClick={onRetry}>
            <FormattedMessage
              id="contracts.analysis.retryRequest"
              defaultMessage="Retry Request-context Analysis"
            />
          </Button>
        )}
      {canRun && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={running || analysis.latestRun?.state === "pending"}
          onClick={onRun}
        >
          <Sparkles size={16} aria-hidden="true" />
          {running || analysis.latestRun?.state === "pending" ? (
            <FormattedMessage id="contracts.analysis.running" defaultMessage="Running…" />
          ) : (
            <FormattedMessage id="contracts.analysis.run" defaultMessage="Run analysis" />
          )}
        </Button>
      )}
      {canConfirm && flagged.length > 1 && (
        <ConfirmUnverified
          onConfirm={onConfirmAll}
          label={
            <FormattedMessage id="contracts.analysis.confirmAll" defaultMessage="Confirm all" />
          }
        />
      )}
    </>
  );
}

/** What went wrong, under the Fields section header. A finished run
 * needs no sentence: each value it wrote carries its own marker,
 * evidence and Confirm on its own row. A failure has no row, so it is
 * said here, and so is a refusal the overflow menu's run earned
 * (DES-075 amendment, 2026-09-22). */
export function AnalysisRunNote({
  analysis,
  runError,
}: Readonly<{
  analysis: ContractAnalysis;
  runError?: string;
}>) {
  const intl = useIntl();
  const run = analysis.latestRun;
  const failure = run?.state === "failed" ? run : null;
  if (!failure && !runError) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-border-muted px-4 py-3">
      {failure && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {failure.trigger === "conversion" ? (
            <FormattedMessage
              id="contracts.analysis.requestFailed"
              defaultMessage="Request-context Analysis failed. The Contract was created successfully. Check the Type, sources and AI settings, then retry."
            />
          ) : (
            <FormattedMessage
              id="contracts.analysis.failedShort"
              defaultMessage="Analysis failed: {reason}"
              values={{
                reason:
                  failure.failure ??
                  intl.formatMessage({
                    id: "contracts.record.notRecorded",
                    defaultMessage: "\u2014",
                  }),
              }}
            />
          )}
        </p>
      )}
      {runError && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {runError}
        </p>
      )}
    </div>
  );
}
