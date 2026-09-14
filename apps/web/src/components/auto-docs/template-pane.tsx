// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The template pane (DES-087 clause 3): the current file's reading with
 * every Placeholder drawn as a chip and every Block as a bracketed span,
 * beside the form that fills it. A chip is a button that selects its
 * form field; a Block tag selects its Clause row.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";
import { documentComparisonPath } from "../../lib/documents";
import { formatRelativeOrShort } from "../../lib/format";
import type { AutoDocAnswer, AutoDocClauseRule, AutoDocReading } from "../../lib/auto-docs";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useRuleWords } from "./rule-words";

type Segment = AutoDocReading["parts"][number]["paragraphs"][number][number];

export function TemplatePane({
  record,
  reading,
  selected,
  onSelectField,
  onSelectBlock,
  onUpload,
  onOpenVersion,
}: {
  record: AutoDocAnswer;
  reading: AutoDocReading | null;
  selected: { kind: "field"; slug: string } | { kind: "block"; name: string } | null;
  onSelectField: (slug: string) => void;
  onSelectBlock: (name: string) => void;
  onUpload: () => void;
  onOpenVersion: (versionId: string) => void;
}) {
  const intl = useIntl();
  const words = useRuleWords();
  const [earlierOpen, setEarlierOpen] = useState(false);
  const versions = record.template?.versions ?? [];
  const current = versions[0];
  const earlier = versions.slice(1);
  const fields = record.formVersion?.definition.fields ?? [];
  const rules = record.formVersion?.definition.clauseRules ?? [];
  const archived = record.autoDoc.state === "archived";
  const ruleFor = (name: string): AutoDocClauseRule | undefined =>
    rules.find((rule) => rule.blockName === name);

  function chip(segment: Segment, key: number) {
    if (segment.kind === "text") return <span key={key}>{segment.text}</span>;
    if (segment.kind === "placeholder") {
      const on = selected?.kind === "field" && selected.slug === segment.name;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onSelectField(segment.name)}
          aria-pressed={on}
          aria-label={intl.formatMessage(
            {
              id: "autoDocs.placeholderChip",
              defaultMessage:
                "{hasField, select, true {Placeholder {name}} other {Placeholder {name}, no form field}}",
            },
            { name: segment.name, hasField: segment.hasField },
          )}
          className={cn(
            "mx-0.5 inline-flex rounded-chip px-1 align-baseline text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
            segment.hasField
              ? "bg-status-info-bg text-status-info-fg"
              : "bg-status-danger-bg text-status-danger-fg",
            on && "outline-2 outline-offset-2 outline-accent",
          )}
        >
          {segment.text}
        </button>
      );
    }
    if (segment.kind === "block_open") {
      const rule = ruleFor(segment.name);
      const on = selected?.kind === "block" && selected.name === segment.name;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onSelectBlock(segment.name)}
          aria-pressed={on}
          aria-label={intl.formatMessage(
            { id: "autoDocs.blockTag", defaultMessage: "Block {name}" },
            { name: segment.name },
          )}
          className={cn(
            "me-1 inline-flex rounded-chip px-1 align-baseline text-xs font-medium text-status-success-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
            on && "outline-2 outline-offset-2 outline-accent",
          )}
        >
          {segment.name} ·{" "}
          {rule
            ? intl.formatMessage(
                { id: "autoDocs.blockWhen", defaultMessage: "when {rule}" },
                { rule: words(rule, fields) },
              )
            : intl.formatMessage({ id: "autoDocs.blockAlways", defaultMessage: "always" })}
        </button>
      );
    }
    return (
      <span key={key} className="ms-1 text-xs text-status-success-fg">
        {intl.formatMessage(
          { id: "autoDocs.blockEnd", defaultMessage: "end {name}" },
          { name: segment.name },
        )}
      </span>
    );
  }

  return (
    <Card className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-section-header flex-wrap items-center gap-2 rounded-t-card border-b border-border-default bg-section-header px-4 py-1.5">
        <h2 className="truncate text-base font-semibold">
          {current?.originalFilename ?? (
            <FormattedMessage id="autoDocs.template" defaultMessage="Template" />
          )}
        </h2>
        {current && (
          <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
            <FormattedMessage
              id="autoDocs.fileVersionNumber"
              defaultMessage="File version {number}"
              values={{ number: current.versionNumber }}
            />
          </span>
        )}
        {current && (
          <span className="text-sm text-muted">
            <FormattedMessage
              id="autoDocs.detectionSummary"
              defaultMessage="{placeholders, plural, one {# Placeholder} other {# Placeholders}}, {blocks, plural, one {# Block} other {# Blocks}}"
              values={{
                placeholders: record.detection.placeholders.length,
                blocks: record.detection.blocks.length,
              }}
            />
          </span>
        )}
        <span className="ms-auto flex items-center gap-2">
          {current && (
            <Button variant="link" size="sm" onClick={() => onOpenVersion(current.id)}>
              <FormattedMessage id="autoDocs.open" defaultMessage="Open" />
            </Button>
          )}
          {record.template && versions.length > 1 && (
            <Button asChild variant="secondary" size="sm">
              <Link to={documentComparisonPath(record.template.id, versions[1]!.id, current!.id)}>
                <FormattedMessage id="autoDocs.compareFiles" defaultMessage="Compare files" />
              </Link>
            </Button>
          )}
          {!archived && (
            <Button variant="secondary" size="sm" onClick={onUpload}>
              <Upload size={16} aria-hidden="true" />
              <FormattedMessage id="autoDocs.uploadVersion" defaultMessage="Upload version" />
            </Button>
          )}
        </span>
      </div>
      <div className="flex-1 p-6">
        {!current ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="autoDocs.noTemplate"
              defaultMessage="Upload a Word file to start the form."
            />
          </p>
        ) : !reading ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="autoDocs.readingUnavailable"
              defaultMessage="The file could not be read. Open it to see the page."
            />
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {reading.parts.map((part) => (
              <section key={part.name} aria-label={partLabel(part.kind, intl)}>
                {part.kind !== "body" && (
                  <p className="mb-2 text-xs font-semibold text-muted">
                    {partLabel(part.kind, intl)}
                  </p>
                )}
                <div className="flex flex-col gap-3 text-md leading-relaxed">
                  {part.paragraphs.map((paragraph, index) => {
                    const opens = paragraph.some((segment) => segment.kind === "block_open");
                    const closes = paragraph.some((segment) => segment.kind === "block_close");
                    return (
                      <p
                        key={index}
                        className={cn(
                          (opens || closes) && "border-s-2 border-status-success-fg ps-3",
                        )}
                      >
                        {paragraph.map(chip)}
                      </p>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-border-default px-4 py-2 text-sm">
        {earlier.length > 0 && (
          <div>
            <button
              type="button"
              aria-expanded={earlierOpen}
              onClick={() => setEarlierOpen((open) => !open)}
              className="flex items-center gap-1 rounded-button font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
            >
              {earlierOpen ? (
                <ChevronDown size={16} aria-hidden="true" className="text-muted" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" className="text-muted" />
              )}
              <FormattedMessage
                id="autoDocs.earlierVersions"
                defaultMessage="Earlier versions ({count})"
                values={{ count: earlier.length }}
              />
            </button>
            {earlierOpen && (
              <ul className="mt-1 flex flex-col">
                {earlier.map((version) => (
                  <li key={version.id} className="flex items-center gap-3 py-1 ps-5">
                    <span className="text-muted">
                      <FormattedMessage
                        id="autoDocs.fileVersionLabel"
                        defaultMessage="File version {number} · {filename}"
                        values={{
                          number: version.versionNumber,
                          filename: version.originalFilename,
                        }}
                      />{" "}
                      · {formatRelativeOrShort(version.createdAt, { locale: intl.locale })}
                    </span>
                    <Button variant="link" size="sm" onClick={() => onOpenVersion(version.id)}>
                      <FormattedMessage id="autoDocs.open" defaultMessage="Open" />
                    </Button>
                    <a
                      className="text-link hover:underline"
                      href={`/api/v1/documents/${encodeURIComponent(record.template!.id)}/versions/${encodeURIComponent(version.id)}/download`}
                    >
                      <FormattedMessage id="autoDocs.download" defaultMessage="Download" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Link to="/help/auto-doc-template" className="text-link hover:underline">
          <FormattedMessage
            id="autoDocs.templateHelpLink"
            defaultMessage="How to write an Auto-Doc template"
          />
        </Link>
      </div>
    </Card>
  );
}

function partLabel(
  kind: AutoDocReading["parts"][number]["kind"],
  intl: ReturnType<typeof useIntl>,
) {
  return intl.formatMessage(
    {
      id: "autoDocs.readingPart",
      defaultMessage:
        "{kind, select, body {Body} header {Header} footer {Footer} footnotes {Footnotes} other {Endnotes}}",
    },
    { kind },
  );
}
