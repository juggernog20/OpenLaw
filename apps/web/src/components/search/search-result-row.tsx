// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one result row shared by the header listbox and `/search`: the
 * DES-010 keyboard contract, the DES-029 confidential marker, and copy
 * wrapped per DES-013.
 */
import type { ComponentType, PointerEvent, ReactNode } from "react";
import type { DocumentOwner } from "@openlaw/shared";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  FileSignature,
  FileText,
  Inbox,
  Landmark,
  type LucideProps,
} from "lucide-react";
import { defineMessages, type IntlShape, useIntl } from "react-intl";
import { Link } from "react-router";
import { contractReference } from "../../lib/contracts";
import { matterReference } from "../../lib/matters";
import { requestReference } from "../../lib/requests";
import type { SearchKind, SearchResult } from "../../lib/search";
import { cn } from "../../lib/utils";
import { ConfidentialMarker } from "../confidential-marker";

export const SEARCH_KIND_ORDER = [
  "contract",
  "matter",
  "document",
  "entity",
  "counterparty",
  "request",
] as const satisfies readonly SearchKind[];

const MESSAGES = defineMessages({
  contract: { id: "search.kind.contract", defaultMessage: "Contract" },
  matter: { id: "search.kind.matter", defaultMessage: "Matter" },
  document: { id: "search.kind.document", defaultMessage: "Document" },
  entity: { id: "search.kind.entity", defaultMessage: "Entity" },
  counterparty: { id: "search.kind.counterparty", defaultMessage: "Counterparty" },
  request: { id: "search.kind.request", defaultMessage: "Request" },
  version: { id: "search.result.version", defaultMessage: "v{number}" },
  ownedBy: { id: "search.result.ownedBy", defaultMessage: "Owned by" },
});

const KIND_ICON: Record<SearchKind, ComponentType<LucideProps>> = {
  contract: FileSignature,
  matter: BriefcaseBusiness,
  document: FileText,
  entity: Landmark,
  counterparty: Building2,
  request: Inbox,
};

export function searchKindLabel(intl: IntlShape, kind: SearchKind): string {
  return intl.formatMessage(MESSAGES[kind]);
}

function reference(intl: IntlShape, result: SearchResult): string {
  switch (result.kind) {
    case "contract":
      return result.number === null
        ? searchKindLabel(intl, result.kind)
        : contractReference(intl, result.number);
    case "matter":
      return result.number === null
        ? searchKindLabel(intl, result.kind)
        : matterReference(intl, result.number);
    case "request":
      return result.number === null
        ? searchKindLabel(intl, result.kind)
        : requestReference(intl, result.number);
    case "document":
      return intl.formatMessage(MESSAGES.version, { number: result.versionNumber });
    case "entity":
    case "counterparty":
      return searchKindLabel(intl, result.kind);
  }
}

function ownerReference(intl: IntlShape, result: Extract<SearchResult, { kind: "document" }>) {
  switch (result.ownerKind) {
    case "contract":
      return contractReference(intl, result.ownerNumber!);
    case "matter":
      return matterReference(intl, result.ownerNumber!);
    case "entity":
      return searchKindLabel(intl, "entity");
  }
}

function ownerRoute(owner: DocumentOwner): string {
  switch (owner) {
    case "contract":
      return "contracts";
    case "matter":
      return "matters";
    case "entity":
      return "entities";
  }
}

function OwnerIcon({ owner }: Readonly<{ owner: DocumentOwner }>) {
  switch (owner) {
    case "contract":
      return <FileSignature size={16} aria-hidden="true" />;
    case "matter":
      return <BriefcaseBusiness size={16} aria-hidden="true" />;
    case "entity":
      return <Landmark size={16} aria-hidden="true" />;
  }
}

/** The route behind a result. Counterparties have no record page in v1,
 * so their row opens the Contract answer for that exact name. */
export function searchResultPath(result: SearchResult, query: string): string {
  switch (result.kind) {
    case "contract":
      return result.number === null
        ? searchPagePath(result.title, "contract")
        : `/contracts/${String(result.number)}`;
    case "matter":
      return result.number === null
        ? searchPagePath(result.title, "matter")
        : `/matters/${String(result.number)}`;
    case "request":
      return result.number === null
        ? searchPagePath(result.title, "request")
        : `/inbox/${String(result.number)}`;
    case "entity":
      return `/entities/${encodeURIComponent(result.id)}`;
    case "counterparty":
      return searchPagePath(result.title, "contract");
    case "document": {
      const params = new URLSearchParams({
        doc: result.id,
        version: result.versionId,
        find: query,
      });
      return result.ownerKind === "entity"
        ? `/entities/${encodeURIComponent(result.ownerId)}/documents?${params.toString()}`
        : `/${ownerRoute(result.ownerKind)}/${String(result.ownerNumber)}/documents?${params.toString()}`;
    }
  }
}

export function searchPagePath(query: string, kind?: SearchKind): string {
  const params = new URLSearchParams({ q: query });
  if (kind) params.set("kind", kind);
  return `/search?${params.toString()}`;
}

/** Turns only the server's mark tokens into elements. Every source word
 * remains React text, so a Document body cannot become HTML. */
function HighlightedSnippet({ value }: Readonly<{ value: string }>) {
  const pieces = value.split(/(<mark>|<\/mark>)/);
  let marked = false;
  const rendered: ReactNode[] = [];
  pieces.forEach((piece, index) => {
    if (piece === "<mark>") {
      marked = true;
      return;
    }
    if (piece === "</mark>") {
      marked = false;
      return;
    }
    if (piece === "") return;
    rendered.push(
      marked ? (
        <mark
          key={index}
          className="rounded-chip bg-status-warning-bg px-0.5 font-semibold text-status-warning-fg"
        >
          {piece}
        </mark>
      ) : (
        <span key={index}>{piece}</span>
      ),
    );
  });
  return <>{rendered}</>;
}

function RowBody({ result }: Readonly<{ result: SearchResult }>) {
  const intl = useIntl();
  const Icon = KIND_ICON[result.kind];
  return (
    <>
      <span className="flex size-7.5 shrink-0 items-center justify-center rounded-card bg-control text-muted">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-semibold text-muted">
            {reference(intl, result)}
          </span>
          <span className="truncate text-sm font-medium text-primary">{result.title}</span>
          {result.isConfidential && <ConfidentialMarker />}
        </span>
        {result.kind === "document" && (
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span>{intl.formatMessage(MESSAGES.ownedBy)}</span>
              <OwnerIcon owner={result.ownerKind} />
              <span className="font-medium text-link">{ownerReference(intl, result)}</span>
            </span>
            <span className="truncate text-xs text-muted">
              <HighlightedSnippet value={result.snippet} />
            </span>
          </>
        )}
      </span>
      <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
    </>
  );
}

const ROW_CLASS =
  "flex min-h-14 w-full items-center gap-3 border-b border-border-muted px-3 py-2 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link";

export function SearchResultRow({
  result,
  query,
  option,
}: Readonly<{
  result: SearchResult;
  query: string;
  option?: {
    id: string;
    active: boolean;
    onActivate: () => void;
    onPoint: () => void;
  };
}>) {
  if (option) {
    return (
      <div
        id={option.id}
        role="option"
        aria-selected={option.active}
        className={cn(
          ROW_CLASS,
          "cursor-default",
          option.active ? "bg-status-info-bg" : "bg-raised",
        )}
        onPointerDown={(event: PointerEvent) => {
          event.preventDefault();
          option.onActivate();
        }}
        onMouseMove={option.onPoint}
      >
        <RowBody result={result} />
      </div>
    );
  }

  return (
    <Link
      className={cn(ROW_CLASS, "bg-raised hover:bg-control")}
      to={searchResultPath(result, query)}
    >
      <RowBody result={result} />
    </Link>
  );
}
