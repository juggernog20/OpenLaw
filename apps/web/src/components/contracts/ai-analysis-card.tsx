// SPDX-License-Identifier: AGPL-3.0-only

/** The Contract record's CTR-008 review surface and inline marker. */

import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Sparkles } from "lucide-react";
import { FormattedDate, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import type { ContractAnalysis, ContractAnalysisResult, ContractRow } from "../../lib/contracts";
import type { AttachedField } from "../../lib/custom-fields";
import { formatContractValue, termTypeLabel } from "../../lib/contracts";
import { formatShortDate } from "../../lib/format";
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
}: Readonly<{
  onConfirm: () => Promise<string | undefined>;
  label?: ReactNode;
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
      <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void confirm()}>
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

const CORE_LABELS: Readonly<Record<string, { id: string; defaultMessage: string }>> = {
  term_type: { id: "contracts.form.termType", defaultMessage: "Term type" },
  effective_date: { id: "contracts.form.effectiveDate", defaultMessage: "Effective date" },
  expiry_date: { id: "contracts.form.expiryDate", defaultMessage: "Expiry date" },
  renewal_period_months: {
    id: "contracts.form.renewalPeriod",
    defaultMessage: "Renewal period (months)",
  },
  notice_period_days: {
    id: "contracts.form.noticePeriod",
    defaultMessage: "Notice period (days)",
  },
  value: { id: "contracts.form.value", defaultMessage: "Value" },
  counterparty: { id: "contracts.analysis.counterparty", defaultMessage: "Counterparty" },
};

const OUTCOME_LABELS: Readonly<
  Record<ContractAnalysisResult["outcome"], { id: string; defaultMessage: string }>
> = {
  written: { id: "contracts.analysis.outcome.written", defaultMessage: "Written" },
  kept: { id: "contracts.analysis.outcome.kept", defaultMessage: "Kept" },
  unsupported: {
    id: "contracts.analysis.outcome.unsupported",
    defaultMessage: "Unsupported",
  },
  invalid: { id: "contracts.analysis.outcome.invalid", defaultMessage: "Invalid" },
  unmatched: { id: "contracts.analysis.outcome.unmatched", defaultMessage: "Unmatched" },
};

function resultLabel(slug: string, fields: readonly AttachedField[]): ReactNode {
  const core = CORE_LABELS[slug];
  return core ? (
    <FormattedMessage {...core} />
  ) : (
    (fields.find((field) => field.slug === slug)?.displayName ?? slug)
  );
}

function isContractValue(value: unknown): value is NonNullable<ContractRow["value"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.amount === "number" &&
    typeof candidate.currency === "string" &&
    ["one_time", "monthly", "annually"].includes(String(candidate.cadence))
  );
}

function resultValue(intl: IntlShape, slug: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return intl.formatMessage({ id: "contracts.record.notRecorded", defaultMessage: "—" });
  }
  if (isContractValue(value)) return formatContractValue(intl, value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") {
    return intl.formatMessage(
      {
        id: "contracts.analysis.booleanValue",
        defaultMessage: "{value, select, true {Yes} other {No}}",
      },
      { value: String(value) },
    );
  }
  if (typeof value === "string" && ["fixed", "auto_renew", "evergreen"].includes(value)) {
    return termTypeLabel(intl, value as ContractRow["termType"]);
  }
  if (
    typeof value === "string" &&
    (slug === "effective_date" || slug === "expiry_date") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return formatShortDate(value, { locale: intl.locale });
  }
  return String(value);
}

function legacyResults(analysis: ContractAnalysis): ContractAnalysisResult[] {
  const outcome = analysis.latestRun?.outcome;
  if (!outcome) return [];
  if (outcome.results) return outcome.results;
  return [
    ...outcome.written.map((slug) => ({
      slug,
      value: null,
      evidence: null,
      outcome: "written" as const,
    })),
    ...outcome.kept.map((slug) => ({
      slug,
      value: null,
      evidence: null,
      outcome: "kept" as const,
    })),
    ...outcome.unsupported.map((slug) => ({
      slug,
      value: null,
      evidence: null,
      outcome: "unsupported" as const,
    })),
    ...outcome.invalid.map((slug) => ({
      slug,
      value: null,
      evidence: null,
      outcome: "invalid" as const,
    })),
    ...(outcome.unmatched
      ? [
          {
            slug: "counterparty",
            value: outcome.unmatched,
            evidence: null,
            outcome: "unmatched" as const,
          },
        ]
      : []),
  ];
}

function RunSentence({ analysis }: Readonly<{ analysis: ContractAnalysis }>) {
  const run = analysis.latestRun;
  if (!run) {
    return (
      <FormattedMessage id="contracts.analysis.notRun" defaultMessage="No analysis has run yet." />
    );
  }
  if (run.state === "pending") {
    return <FormattedMessage id="contracts.analysis.running" defaultMessage="Running…" />;
  }
  const version = run.versionNumber ?? run.versionId ?? "—";
  const when = run.finishedAt ? (
    <FormattedDate value={run.finishedAt} dateStyle="medium" timeStyle="short" />
  ) : (
    "—"
  );
  if (run.state === "failed") {
    return (
      <FormattedMessage
        id="contracts.analysis.failed"
        defaultMessage="Failed {when} on Version {version} with {model}: {reason}"
        values={{ when, version, model: run.model, reason: run.failure ?? "—" }}
      />
    );
  }
  return (
    <FormattedMessage
      id="contracts.analysis.completed"
      defaultMessage="Completed {when} on Version {version} with {model}."
      values={{
        when,
        version,
        model: run.model,
      }}
    />
  );
}

export function AiAnalysisCard({
  analysis,
  contract,
  fields,
  canRun,
  canConfirm,
  onRun,
  onConfirm,
  onConfirmAll,
}: Readonly<{
  analysis: ContractAnalysis;
  contract: ContractRow;
  fields: readonly AttachedField[];
  canRun: boolean;
  canConfirm: boolean;
  onRun: () => Promise<string | undefined>;
  onConfirm: (slug: string) => Promise<string | undefined>;
  onConfirmAll: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string>();
  const results = useMemo(() => legacyResults(analysis), [analysis]);
  const flagged = Object.keys(contract.aiUnverified ?? {});

  if (!analysis.available && flagged.length === 0) return null;

  async function run() {
    if (running) return;
    setRunning(true);
    setRunError(undefined);
    const refusal = await onRun().finally(() => setRunning(false));
    setRunError(refusal);
  }

  return (
    <section
      aria-labelledby="contract-ai-analysis-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-section-header flex-wrap items-center gap-2 rounded-t-card border-b border-border-default bg-section-header px-4 py-2">
        <h2 id="contract-ai-analysis-heading" className="me-auto text-base font-semibold">
          <FormattedMessage id="contracts.analysis.heading" defaultMessage="AI analysis" />
        </h2>
        {canRun && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={running}
            onClick={() => void run()}
          >
            <Sparkles size={16} aria-hidden="true" />
            <FormattedMessage id="contracts.analysis.run" defaultMessage="Run analysis" />
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
      </header>
      <p className="px-4 py-3 text-sm text-secondary">
        <RunSentence analysis={analysis} />
      </p>
      {runError && (
        <p role="alert" className="px-4 pb-3 text-sm text-status-danger-fg">
          {runError}
        </p>
      )}
      {results.length > 0 && (
        <ul
          className="border-t border-border-muted"
          aria-label={intl.formatMessage({
            id: "contracts.analysis.results",
            defaultMessage: "Analysis results",
          })}
        >
          {results.map((result) => {
            const marker = contract.aiUnverified?.[result.slug];
            return (
              <li
                key={result.slug}
                className="grid gap-2 border-b border-border-muted px-4 py-3 last:border-b-0 @2xl/page:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1fr)_minmax(12rem,1.5fr)_auto] @2xl/page:items-start"
              >
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {resultLabel(result.slug, fields)}
                  {marker && <UnverifiedMarker />}
                </div>
                <span className="break-words text-md">
                  {resultValue(intl, result.slug, result.value)}
                </span>
                <blockquote className="border-s-2 border-border-default ps-2 text-sm text-muted">
                  {result.evidence ?? marker?.evidence ?? (
                    <FormattedMessage
                      id="contracts.analysis.noEvidence"
                      defaultMessage="No evidence returned."
                    />
                  )}
                </blockquote>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
                    <FormattedMessage {...OUTCOME_LABELS[result.outcome]} />
                  </span>
                  {marker && canConfirm && (
                    <ConfirmUnverified onConfirm={() => onConfirm(result.slug)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
