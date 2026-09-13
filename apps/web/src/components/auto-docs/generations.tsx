// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: the Auto-Doc keeps every Generation, including a failed fill. */
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import { formatFullDate, formatLongDateTime } from "../../lib/format";
import type { AutoDocGeneration } from "../../lib/auto-docs";

export function GenerationState({ state }: { state: AutoDocGeneration["state"] }) {
  return (
    <FormattedMessage
      id="autoDocs.generationState"
      defaultMessage="{state, select, pending {Pending} ready {Ready} other {Failed}}"
      values={{ state }}
    />
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
export function GenerationDownload({ generation }: { generation: AutoDocGeneration }) {
  return generation.hasDocx ? (
    <a
      className="text-link hover:underline"
      href={`/api/v1/auto-docs/${generation.autoDocId}/generations/${generation.id}/docx`}
    >
      <FormattedMessage id="autoDocs.downloadWord" defaultMessage="Download Word" />
    </a>
  ) : null;
}
export function AutoDocGenerations({ generations }: { generations: AutoDocGeneration[] }) {
  return (
    <section
      aria-labelledby="auto-doc-generations-title"
      className="space-y-4 rounded-card border border-border-default bg-raised p-6"
    >
      <h2 id="auto-doc-generations-title" className="text-lg font-semibold">
        <FormattedMessage id="autoDocs.generations" defaultMessage="Generations" />
      </h2>
      {generations.length === 0 ? (
        <p className="text-sm text-muted">
          <FormattedMessage id="autoDocs.noGenerations" defaultMessage="No Generations yet." />
        </p>
      ) : (
        <ul className="divide-y divide-border-default">
          {generations.map((generation) => (
            <li key={generation.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-3">
                <Link
                  className="text-link hover:underline"
                  to={`/auto-docs/${generation.autoDocId}/generations/${generation.id}`}
                >
                  <GenerationState state={generation.state} /> · {generation.person.displayName}
                </Link>
                <time
                  dateTime={generation.createdAt}
                  title={formatLongDateTime(generation.createdAt)}
                >
                  {formatFullDate(generation.createdAt)}
                </time>
              </div>
              <p className="text-muted">
                <GenerationPair generation={generation} />
              </p>
              {generation.failure && (
                <p className="text-status-danger-fg">{generation.failure.detail}</p>
              )}
              <GenerationDownload generation={generation} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
