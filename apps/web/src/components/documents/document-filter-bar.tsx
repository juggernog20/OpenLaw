// SPDX-License-Identifier: AGPL-3.0-only

/** M26/3's fixed, URL-backed controls for the flat Documents repository. */
import { useEffect, useId, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { DatePicker } from "../date-picker";
import { CONTROL_CLASS } from "../../lib/form-controls";
import {
  DOCUMENT_REPOSITORY_FORMATS,
  DOCUMENT_REPOSITORY_KINDS,
  documentKindLabel,
  documentRecordReference,
  FOLDER_ROOT,
  type DocumentRepositoryFilters,
  type DocumentVersionKind,
} from "../../lib/documents";
import { pathOf, readRecordFolders, type ContractFolder } from "../../lib/folders";
import { search, type SearchResult } from "../../lib/search";

type FilterKey = keyof DocumentRepositoryFilters;

const FORMAT_LABELS: Record<(typeof DOCUMENT_REPOSITORY_FORMATS)[number], string> = {
  pdf: "PDF",
  word: "Word",
  powerpoint: "PowerPoint",
  image: "Image",
  email: "Email",
  other: "Other",
};

function referenceOf(result: SearchResult): string | null {
  if (result.kind === "contract") return `C-${result.number}`;
  if (result.kind === "matter") return `M-${result.number}`;
  return null;
}

export function DocumentFilterBar({
  filters,
  busy,
  empty,
  error,
  onFilter,
  onClear,
}: Readonly<{
  filters: DocumentRepositoryFilters;
  busy: boolean;
  empty: boolean;
  error: string | null;
  onFilter: <K extends FilterKey>(key: K, value: DocumentRepositoryFilters[K]) => void;
  onClear: () => void;
}>) {
  const intl = useIntl();
  const listboxId = useId();
  const [recordDraft, setRecordDraft] = useState<string | null>(null);
  const recordText = recordDraft ?? filters.record;
  const [matchAnswer, setMatchAnswer] = useState<{ query: string; rows: SearchResult[] }>({
    query: "",
    rows: [],
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [folderAnswer, setFolderAnswer] = useState<{
    reference: string;
    rows: ContractFolder[];
  }>({ reference: "", rows: [] });
  const folders = folderAnswer.reference === filters.record ? folderAnswer.rows : [];
  const matches = matchAnswer.query === recordText.trim() ? matchAnswer.rows : [];

  useEffect(() => {
    const record = documentRecordReference(filters.record);
    let cancelled = false;
    if (!record) return () => undefined;
    void readRecordFolders(record).then((answer) => {
      if (!cancelled && answer.ok) {
        setFolderAnswer({ reference: filters.record, rows: answer.folders });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filters.record]);

  useEffect(() => {
    const query = recordText.trim();
    let cancelled = false;
    if (query.length < 2 || query === filters.record) return () => undefined;
    const timer = window.setTimeout(() => {
      const kinds = filters.owner === "" ? (["contract", "matter"] as const) : [filters.owner];
      void Promise.all(kinds.map((kind) => search(query, { kind, limit: 10 }))).then((answers) => {
        if (cancelled) return;
        const next = answers.flatMap((answer) => (answer.ok ? answer.results : []));
        setMatchAnswer({
          query,
          rows: next.filter((result) => referenceOf(result) !== null).slice(0, 10),
        });
        setSearchOpen(true);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filters.owner, filters.record, recordText]);

  const active: { key: FilterKey; name: string; value: string }[] = [];
  if (filters.owner) {
    active.push({
      key: "owner",
      name: "Owner",
      value: filters.owner === "contract" ? "Contracts" : "Matters",
    });
  }
  if (filters.record) active.push({ key: "record", name: "Record", value: filters.record });
  if (filters.folder) {
    const folder = folders.find((candidate) => candidate.id === filters.folder);
    active.push({
      key: "folder",
      name: "Folder",
      value:
        filters.folder === FOLDER_ROOT
          ? "Record root"
          : folder
            ? pathOf(folders, folder, "/")
            : filters.folder,
    });
  }
  if (filters.format) {
    active.push({ key: "format", name: "Format", value: FORMAT_LABELS[filters.format] });
  }
  if (filters.kind) {
    active.push({
      key: "kind",
      name: "Kind",
      value: documentKindLabel(intl, filters.kind),
    });
  }
  if (filters.uploadedFrom) {
    active.push({ key: "uploadedFrom", name: "Uploaded from", value: filters.uploadedFrom });
  }
  if (filters.uploadedTo) {
    active.push({ key: "uploadedTo", name: "Uploaded to", value: filters.uploadedTo });
  }

  const selectClass = `${CONTROL_CLASS} w-auto min-w-28`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-muted">Owner</legend>
          <div className="inline-flex h-8 rounded-button border border-border-default bg-raised p-0.5">
            {(
              [
                ["", "All"],
                ["contract", "Contracts"],
                ["matter", "Matters"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={filters.owner === value}
                disabled={busy}
                className="rounded-chip px-2.5 text-sm aria-pressed:bg-accent aria-pressed:font-medium disabled:opacity-50"
                onClick={() => onFilter("owner", value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="relative flex min-w-48 flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage id="documents.filter.record" defaultMessage="Record" />
          <input
            role="combobox"
            aria-label={intl.formatMessage({
              id: "documents.filter.record",
              defaultMessage: "Record",
            })}
            aria-autocomplete="list"
            aria-expanded={searchOpen && matches.length > 0}
            aria-controls={listboxId}
            className={CONTROL_CLASS}
            value={recordText}
            disabled={busy}
            placeholder="Reference or title"
            onChange={(event) => {
              setRecordDraft(event.target.value);
              setSearchOpen(false);
              if (filters.record) onFilter("record", "");
            }}
            onFocus={() => setSearchOpen(matches.length > 0)}
            onBlur={() => setSearchOpen(false)}
          />
          {searchOpen && matches.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Record matches"
              className="absolute top-full z-30 mt-1 max-h-64 w-80 overflow-auto rounded-card border border-border-default bg-raised p-1 shadow-lg"
            >
              {matches.map((match) => {
                const reference = referenceOf(match)!;
                return (
                  <li
                    key={`${match.kind}-${match.id}`}
                    role="option"
                    aria-selected={false}
                    className="cursor-pointer rounded-button px-2 py-1.5 text-sm text-primary hover:bg-subtle"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setRecordDraft(null);
                      setSearchOpen(false);
                      onFilter("record", reference);
                    }}
                  >
                    {reference} · {match.title}
                  </li>
                );
              })}
            </ul>
          )}
        </label>

        {filters.record && (
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            <FormattedMessage id="documents.filter.folder" defaultMessage="Folder" />
            <select
              aria-label="Folder"
              className={selectClass}
              value={filters.folder}
              disabled={busy}
              onChange={(event) => onFilter("folder", event.target.value)}
            >
              <option value="">All folders</option>
              <option value={FOLDER_ROOT}>Record root</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {pathOf(folders, folder, "/")}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage id="documents.filter.format" defaultMessage="Format" />
          <select
            aria-label="Format"
            className={selectClass}
            value={filters.format}
            disabled={busy}
            onChange={(event) =>
              onFilter("format", event.target.value as DocumentRepositoryFilters["format"])
            }
          >
            <option value="">All formats</option>
            {DOCUMENT_REPOSITORY_FORMATS.map((format) => (
              <option key={format} value={format}>
                {FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage id="documents.filter.kind" defaultMessage="Kind" />
          <select
            aria-label="Kind"
            className={selectClass}
            value={filters.kind}
            disabled={busy}
            onChange={(event) =>
              onFilter("kind", event.target.value as DocumentRepositoryFilters["kind"])
            }
          >
            <option value="">All kinds</option>
            {DOCUMENT_REPOSITORY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {documentKindLabel(intl, kind as DocumentVersionKind)}
              </option>
            ))}
          </select>
        </label>

        <label
          className="flex flex-col gap-1 text-xs font-medium text-muted"
          htmlFor="documents-uploaded-from"
        >
          <FormattedMessage id="documents.filter.uploadedFrom" defaultMessage="Uploaded from" />
          <DatePicker
            id="documents-uploaded-from"
            value={filters.uploadedFrom}
            disabled={busy}
            onChange={(value) => onFilter("uploadedFrom", value)}
          />
        </label>
        <label
          className="flex flex-col gap-1 text-xs font-medium text-muted"
          htmlFor="documents-uploaded-to"
        >
          <FormattedMessage id="documents.filter.uploadedTo" defaultMessage="Uploaded to" />
          <DatePicker
            id="documents-uploaded-to"
            value={filters.uploadedTo}
            disabled={busy}
            onChange={(value) => onFilter("uploadedTo", value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-status-danger-fg">
            {error}
          </p>
        )}
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {active.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex items-center gap-1 rounded-pill bg-subtle px-2 py-1 text-xs"
            >
              <span>
                {filter.name}: {filter.value}
              </span>
              <button
                type="button"
                aria-label={`Remove ${filter.name} filter`}
                disabled={busy}
                className="rounded-pill p-0.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-link"
                onClick={() => onFilter(filter.key, "")}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            aria-label="Clear all filters"
            disabled={busy}
            className="px-1 text-xs font-medium text-link hover:underline disabled:opacity-50"
            onClick={onClear}
          >
            Clear all
          </button>
          {empty && <span className="sr-only">The active filters matched no documents.</span>}
        </div>
      )}
    </div>
  );
}
