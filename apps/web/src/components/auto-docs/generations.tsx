// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: the Auto-Doc keeps every Generation, including a failed fill. */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, useRevalidator } from "react-router";
import { formatFullDate, formatLongDateTime } from "../../lib/format";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { SettingsCard } from "../settings-card";
import { GenerationFiling } from "./filings";
import type { AutoDocGeneration } from "../../lib/auto-docs";

const STATE_PILL: Record<AutoDocGeneration["state"], string> = {
  pending: "bg-status-neutral-bg text-status-neutral-fg",
  ready: "bg-status-success-bg text-status-success-fg",
  failed: "bg-status-danger-bg text-status-danger-fg",
};
export function GenerationState({ state }: { state: AutoDocGeneration["state"] }) {
  return (
    <FormattedMessage
      id="autoDocs.generationState"
      defaultMessage="{state, select, pending {Pending} ready {Ready} other {Failed}}"
      values={{ state }}
    />
  );
}
export function GenerationStatusPill({ state }: { state: AutoDocGeneration["state"] }) {
  return (
    <span
      className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${STATE_PILL[state]}`}
    >
      <GenerationState state={state} />
    </span>
  );
}
export function GenerationPair({ generation }: { generation: AutoDocGeneration }) {
  return (
    <FormattedMessage
      id="autoDocs.generationPair"
      defaultMessage="File version {fileVersion}, form version {formVersion}"
      values={{
        fileVersion: generation.documentVersionNumber,
        formVersion: generation.formVersionNumber,
      }}
    />
  );
}
export function generationWaiting(generation: AutoDocGeneration): boolean {
  return (
    generation.filingPending ||
    generation.state === "pending" ||
    (generation.state === "ready" && generation.emailState === "pending")
  );
}
export function GenerationDownload({
  generation,
  portal = false,
}: {
  generation: AutoDocGeneration;
  portal?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      {generation.hasDocx && generation.formats !== "pdf" && (
        <a
          className="text-link hover:underline"
          href={`/api/v1/${portal ? "portal/" : ""}auto-docs/${generation.autoDocId}/generations/${generation.id}/docx`}
        >
          <FormattedMessage id="autoDocs.downloadWord" defaultMessage="Download Word" />
        </a>
      )}
      {generation.hasPdf && generation.formats !== "docx" && (
        <a
          className="text-link hover:underline"
          href={`/api/v1/${portal ? "portal/" : ""}auto-docs/${generation.autoDocId}/generations/${generation.id}/pdf`}
        >
          <FormattedMessage id="autoDocs.downloadPdf" defaultMessage="Download PDF" />
        </a>
      )}
    </div>
  );
}
export function GenerationContract({
  generation,
  portal = false,
}: {
  generation: AutoDocGeneration;
  portal?: boolean;
}) {
  const contract = generation.createdContract;
  if (!contract) return null;
  return (
    <p className="text-sm">
      <FormattedMessage
        id="autoDocs.createdContract"
        defaultMessage="Created Contract: {contract}"
        values={{
          contract: (
            <Link
              className="text-link hover:underline"
              to={`${portal ? "/portal" : ""}/contracts/${contract.number}`}
            >
              {contract.title}
            </Link>
          ),
        }}
      />
    </p>
  );
}

export function GenerationEmail({ generation }: { generation: AutoDocGeneration }) {
  if (generation.emailState === "unconfigured")
    return <p className="text-sm text-muted">{generation.emailFailure?.detail}</p>;
  if (generation.emailState === "sent" && generation.emailSentAt)
    return (
      <p className="text-sm text-muted">
        <FormattedMessage id="autoDocs.emailSent" defaultMessage="Email sent" /> ·{" "}
        <time dateTime={generation.emailSentAt} title={formatLongDateTime(generation.emailSentAt)}>
          {formatFullDate(generation.emailSentAt)}
        </time>
      </p>
    );
  if (generation.emailState === "not_requested") return null;
  return (
    <p className="text-sm text-muted">
      {generation.emailState === "failed" || generation.state === "failed" ? (
        <FormattedMessage id="autoDocs.emailNotSent" defaultMessage="Email not sent" />
      ) : (
        <FormattedMessage id="autoDocs.emailPending" defaultMessage="Email pending" />
      )}
    </p>
  );
}
export function AutoDocGenerations({ generations }: { generations: AutoDocGeneration[] }) {
  const intl = useIntl();
  const { revalidate } = useRevalidator();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const waiting = generations.some(generationWaiting);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void revalidate(), 1500);
    return () => clearInterval(timer);
  }, [waiting, revalidate]);
  async function retry(generation: AutoDocGeneration) {
    setRetrying(generation.id);
    setError(undefined);
    const result = await api
      .POST("/api/v1/auto-docs/{id}/generations/{generationId}/retry", {
        params: { path: { id: generation.autoDocId, generationId: generation.id } },
        body: {},
      })
      .catch(() => undefined);
    if (result?.data) await revalidate();
    else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.retryFailed",
            defaultMessage: "Could not retry this Generation. Try again.",
          }),
      );
    setRetrying(null);
  }

  return (
    <SettingsCard
      region
      title={<FormattedMessage id="autoDocs.generations" defaultMessage="Generations" />}
      actions={
        <span className="text-sm text-muted">
          <FormattedMessage
            id="autoDocs.generationCount"
            defaultMessage="{count, plural, one {# Generation} other {# Generations}}"
            values={{ count: generations.length }}
          />
        </span>
      }
      flush
      className="max-w-none"
    >
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-status-danger-fg">
          {error}
        </p>
      )}
      {generations.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">
          <FormattedMessage id="autoDocs.noGenerations" defaultMessage="No Generations yet." />
        </p>
      ) : (
        <ul>
          {generations.map((generation) => (
            <li
              key={generation.id}
              className="flex flex-col gap-2 border-b border-border-muted px-4 py-3 text-sm last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  className="font-medium text-primary hover:underline"
                  to={`/auto-docs/${generation.autoDocId}/generations/${generation.id}`}
                >
                  {generation.person.displayName}
                </Link>
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs font-medium ${STATE_PILL[generation.state]}`}
                >
                  <GenerationState state={generation.state} />
                </span>
                <time
                  dateTime={generation.createdAt}
                  title={formatLongDateTime(generation.createdAt)}
                  className="text-muted"
                >
                  {formatFullDate(generation.createdAt)}
                </time>
                <span className="text-muted">
                  <GenerationPair generation={generation} />
                </span>
                <span className="ms-auto flex items-center gap-2">
                  <Link
                    className="text-link hover:underline"
                    to={`/auto-docs/${generation.autoDocId}/generate?from=${generation.id}`}
                  >
                    <FormattedMessage id="autoDocs.generateAgain" defaultMessage="Generate again" />
                  </Link>
                  {generation.state === "failed" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={retrying !== null}
                      onClick={() => void retry(generation)}
                    >
                      <FormattedMessage id="autoDocs.retry" defaultMessage="Retry" />
                    </Button>
                  )}
                </span>
              </div>
              {generation.failure && (
                <p className="text-status-danger-fg">{generation.failure.detail}</p>
              )}
              <GenerationContract generation={generation} />
              <GenerationDownload generation={generation} />
              <GenerationEmail generation={generation} />
              <GenerationFiling generation={generation} />
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
