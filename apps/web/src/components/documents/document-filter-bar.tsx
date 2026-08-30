// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Documents destination's filter strip: URL-backed controls over the
 * standard Document properties DOC-007 allows, drawn in the Contracts
 * filter-row pattern DES-066 records. Built in M26/3 and M26/4.
 */
import { useEffect, useId, useRef, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { DatePicker } from "../date-picker";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { CONTROL_CLASS } from "../../lib/form-controls";
import {
  DOCUMENT_REPOSITORY_FORMATS,
  DOCUMENT_REPOSITORY_KINDS,
  documentKindLabel,
  documentRecordReference,
  FOLDER_ROOT,
  type DocumentRepositoryFilters,
  type DocumentRepositoryOptions,
  type DocumentVersionKind,
} from "../../lib/documents";
import { pathOf, readRecordFolders, type ContractFolder } from "../../lib/folders";
import { cn } from "../../lib/utils";

type FilterKey = keyof DocumentRepositoryFilters;
type ChipFilterKey = Exclude<FilterKey, "includeArchived">;

const MESSAGES = defineMessages({
  owner: { id: "documents.filter.owner", defaultMessage: "Owner" },
  ownerAll: { id: "documents.filter.owner.all", defaultMessage: "All" },
  ownerContracts: { id: "documents.filter.owner.contracts", defaultMessage: "Contracts" },
  ownerMatters: { id: "documents.filter.owner.matters", defaultMessage: "Matters" },
  ownerEntities: { id: "documents.filter.owner.entities", defaultMessage: "Entities" },
  record: { id: "documents.filter.record", defaultMessage: "Record" },
  recordPlaceholder: {
    id: "documents.filter.record.placeholder",
    defaultMessage: "Reference or title",
  },
  recordMatches: { id: "documents.filter.record.matches", defaultMessage: "Record matches" },
  folder: { id: "documents.filter.folder", defaultMessage: "Folder" },
  folderAll: { id: "documents.filter.folder.all", defaultMessage: "All folders" },
  folderRoot: { id: "documents.filter.folder.root", defaultMessage: "Record root" },
  format: { id: "documents.filter.format", defaultMessage: "Format" },
  formatAll: { id: "documents.filter.format.all", defaultMessage: "All formats" },
  kind: { id: "documents.filter.kind", defaultMessage: "Kind" },
  kindAll: { id: "documents.filter.kind.all", defaultMessage: "All kinds" },
  counterparty: { id: "documents.filter.counterparty", defaultMessage: "Counterparty" },
  counterpartyAll: {
    id: "documents.filter.counterparty.all",
    defaultMessage: "All counterparties",
  },
  uploader: { id: "documents.filter.uploader", defaultMessage: "Uploader" },
  uploaderAll: { id: "documents.filter.uploader.all", defaultMessage: "All uploaders" },
  uploaderArchived: {
    id: "documents.filter.uploader.archived",
    defaultMessage: "{name} (archived)",
  },
  uploadedFrom: { id: "documents.filter.uploadedFrom", defaultMessage: "Uploaded from" },
  uploadedTo: { id: "documents.filter.uploadedTo", defaultMessage: "Uploaded to" },
  activeFilters: { id: "documents.filter.active", defaultMessage: "Active filters" },
  chip: { id: "documents.filter.chip", defaultMessage: "{name}: {value}" },
  remove: { id: "documents.filter.remove", defaultMessage: "Remove {name} filter" },
  clearAll: { id: "documents.filter.clearAll", defaultMessage: "Clear all" },
  clearAllLabel: { id: "documents.filter.clearAll.label", defaultMessage: "Clear all filters" },
  matchedNone: {
    id: "documents.filter.matchedNone",
    defaultMessage: "The active filters matched no documents.",
  },
  showArchived: { id: "documents.showArchived", defaultMessage: "Show archived" },
});

const FORMAT_MESSAGES = defineMessages({
  pdf: { id: "documents.format.pdf", defaultMessage: "PDF" },
  word: { id: "documents.format.word", defaultMessage: "Word" },
  powerpoint: { id: "documents.format.powerpoint", defaultMessage: "PowerPoint" },
  image: { id: "documents.format.image", defaultMessage: "Image" },
  email: { id: "documents.format.email", defaultMessage: "Email" },
  other: { id: "documents.format.other", defaultMessage: "Other" },
});

export function DocumentFilterBar({
  filters,
  options,
  busy,
  empty,
  error,
  canManage,
  onFilter,
  onClear,
}: Readonly<{
  filters: DocumentRepositoryFilters;
  options: DocumentRepositoryOptions;
  busy: boolean;
  empty: boolean;
  error: string | null;
  canManage: boolean;
  onFilter: <K extends FilterKey>(key: K, value: DocumentRepositoryFilters[K]) => void;
  onClear: () => void;
}>) {
  const intl = useIntl();
  const listboxId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [recordDraft, setRecordDraft] = useState<string | null>(null);
  const selectedRecord = options.records.find((record) => record.reference === filters.record);
  const selectedLabel =
    selectedRecord?.kind === "entity" ? selectedRecord.title : selectedRecord?.reference;
  const recordText = recordDraft ?? selectedLabel ?? filters.record;
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [folderAnswer, setFolderAnswer] = useState<{
    reference: string;
    rows: ContractFolder[];
  }>({ reference: "", rows: [] });
  const folders = folderAnswer.reference === filters.record ? folderAnswer.rows : [];
  const query = recordDraft?.trim().toLocaleLowerCase() ?? "";
  const matches =
    query.length < 2
      ? []
      : options.records
          .filter((record) => filters.owner === "" || record.kind === filters.owner)
          .filter((record) =>
            `${record.kind === "entity" ? record.title : record.reference} ${record.title}`
              .toLocaleLowerCase()
              .includes(query),
          )
          .slice(0, 10);
  const listOpen = searchOpen && matches.length > 0;
  const active = Math.min(activeIndex, Math.max(matches.length - 1, 0));
  const rowId = (index: number) => `${listboxId}-row-${index}`;

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

  // The arrow keys can walk past the list's foot; the named row has to
  // be in view for a sighted keyboard user, as in the contract picker.
  useEffect(() => {
    if (!listOpen) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [listOpen, active]);

  function pickMatch(index: number) {
    const match = matches[index];
    if (!match) return;
    setRecordDraft(null);
    setSearchOpen(false);
    setActiveIndex(0);
    onFilter("record", match.reference);
  }

  const chips: { key: ChipFilterKey; name: string; value: string }[] = [];
  if (filters.owner) {
    chips.push({
      key: "owner",
      name: intl.formatMessage(MESSAGES.owner),
      value: intl.formatMessage(
        filters.owner === "contract"
          ? MESSAGES.ownerContracts
          : filters.owner === "matter"
            ? MESSAGES.ownerMatters
            : MESSAGES.ownerEntities,
      ),
    });
  }
  if (filters.record) {
    chips.push({
      key: "record",
      name: intl.formatMessage(MESSAGES.record),
      value: selectedLabel ?? filters.record,
    });
  }
  if (filters.folder) {
    const folder = folders.find((candidate) => candidate.id === filters.folder);
    chips.push({
      key: "folder",
      name: intl.formatMessage(MESSAGES.folder),
      value:
        filters.folder === FOLDER_ROOT
          ? intl.formatMessage(MESSAGES.folderRoot)
          : folder
            ? pathOf(folders, folder, "/")
            : filters.folder,
    });
  }
  if (filters.format) {
    chips.push({
      key: "format",
      name: intl.formatMessage(MESSAGES.format),
      value: intl.formatMessage(FORMAT_MESSAGES[filters.format]),
    });
  }
  if (filters.kind) {
    chips.push({
      key: "kind",
      name: intl.formatMessage(MESSAGES.kind),
      value: documentKindLabel(intl, filters.kind),
    });
  }
  if (filters.counterparty) {
    const counterparty = options.counterparties.find(
      (candidate) => candidate.id === filters.counterparty,
    );
    chips.push({
      key: "counterparty",
      name: intl.formatMessage(MESSAGES.counterparty),
      value: counterparty?.name ?? filters.counterparty,
    });
  }
  if (filters.uploader) {
    const uploader = options.uploaders.find((candidate) => candidate.id === filters.uploader);
    chips.push({
      key: "uploader",
      name: intl.formatMessage(MESSAGES.uploader),
      value: uploader?.displayName ?? filters.uploader,
    });
  }
  if (filters.uploadedFrom) {
    chips.push({
      key: "uploadedFrom",
      name: intl.formatMessage(MESSAGES.uploadedFrom),
      value: filters.uploadedFrom,
    });
  }
  if (filters.uploadedTo) {
    chips.push({
      key: "uploadedTo",
      name: intl.formatMessage(MESSAGES.uploadedTo),
      value: filters.uploadedTo,
    });
  }

  const selectClass = `${CONTROL_CLASS} w-auto min-w-28`;
  const ownerOptions = [
    ["", MESSAGES.ownerAll],
    ["contract", MESSAGES.ownerContracts],
    ["matter", MESSAGES.ownerMatters],
    ["entity", MESSAGES.ownerEntities],
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-muted">
            <FormattedMessage {...MESSAGES.owner} />
          </legend>
          <div className="inline-flex h-8 rounded-button border border-border-default bg-raised p-0.5">
            {ownerOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.owner === value}
                disabled={busy}
                className="rounded-chip px-2.5 text-sm aria-pressed:bg-accent aria-pressed:font-medium disabled:opacity-50"
                onClick={() => onFilter("owner", value)}
              >
                <FormattedMessage {...label} />
              </button>
            ))}
          </div>
        </fieldset>

        <label className="relative flex min-w-48 flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.record} />
          <input
            role="combobox"
            aria-label={intl.formatMessage(MESSAGES.record)}
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listboxId}
            aria-activedescendant={listOpen ? rowId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            className={CONTROL_CLASS}
            value={recordText}
            disabled={busy}
            placeholder={intl.formatMessage(MESSAGES.recordPlaceholder)}
            onChange={(event) => {
              setRecordDraft(event.target.value);
              setSearchOpen(event.target.value.trim().length >= 2);
              setActiveIndex(0);
              if (filters.record) onFilter("record", "");
            }}
            onFocus={() => setSearchOpen(matches.length > 0)}
            // Rows commit on pointerdown, ahead of this blur.
            onBlur={() => setSearchOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (matches.length === 0) return;
                setSearchOpen(true);
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex((active + delta + matches.length) % matches.length);
                return;
              }
              if (event.key === "Enter") {
                if (listOpen) {
                  event.preventDefault();
                  pickMatch(active);
                }
                return;
              }
              if (event.key === "Escape" && listOpen) {
                // Local dismiss, as DES-010 reserves the key for.
                event.preventDefault();
                event.stopPropagation();
                setSearchOpen(false);
              }
            }}
          />
          {listOpen && (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={intl.formatMessage(MESSAGES.recordMatches)}
              className="absolute top-full z-30 mt-1 max-h-64 w-80 overflow-auto rounded-card border border-border-default bg-raised p-1 shadow-lg"
            >
              {matches.map((match, index) => (
                <li
                  key={match.reference}
                  id={rowId(index)}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    "cursor-pointer rounded-button px-2 py-1.5 text-sm text-primary",
                    index === active && "bg-subtle",
                  )}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    pickMatch(index);
                  }}
                  onMouseMove={() => setActiveIndex(index)}
                >
                  {match.kind === "entity" ? match.title : match.reference}
                  {match.kind === "entity" || match.reference === match.title
                    ? null
                    : ` · ${match.title}`}
                </li>
              ))}
            </ul>
          )}
        </label>

        {filters.record && (
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            <FormattedMessage {...MESSAGES.folder} />
            <select
              aria-label={intl.formatMessage(MESSAGES.folder)}
              className={selectClass}
              value={filters.folder}
              disabled={busy}
              onChange={(event) => onFilter("folder", event.target.value)}
            >
              <option value="">{intl.formatMessage(MESSAGES.folderAll)}</option>
              <option value={FOLDER_ROOT}>{intl.formatMessage(MESSAGES.folderRoot)}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {pathOf(folders, folder, "/")}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.format} />
          <select
            aria-label={intl.formatMessage(MESSAGES.format)}
            className={selectClass}
            value={filters.format}
            disabled={busy}
            onChange={(event) =>
              onFilter("format", event.target.value as DocumentRepositoryFilters["format"])
            }
          >
            <option value="">{intl.formatMessage(MESSAGES.formatAll)}</option>
            {DOCUMENT_REPOSITORY_FORMATS.map((format) => (
              <option key={format} value={format}>
                {intl.formatMessage(FORMAT_MESSAGES[format])}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.counterparty} />
          <select
            aria-label={intl.formatMessage(MESSAGES.counterparty)}
            className={selectClass}
            value={filters.counterparty}
            disabled={busy}
            onChange={(event) => onFilter("counterparty", event.target.value)}
          >
            <option value="">{intl.formatMessage(MESSAGES.counterpartyAll)}</option>
            {options.counterparties.map((counterparty) => (
              <option key={counterparty.id} value={counterparty.id}>
                {counterparty.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.uploader} />
          <select
            aria-label={intl.formatMessage(MESSAGES.uploader)}
            className={selectClass}
            value={filters.uploader}
            disabled={busy}
            onChange={(event) => onFilter("uploader", event.target.value)}
          >
            <option value="">{intl.formatMessage(MESSAGES.uploaderAll)}</option>
            {options.uploaders.map((uploader) => (
              <option key={uploader.id} value={uploader.id}>
                {uploader.archived
                  ? intl.formatMessage(MESSAGES.uploaderArchived, { name: uploader.displayName })
                  : uploader.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.kind} />
          <select
            aria-label={intl.formatMessage(MESSAGES.kind)}
            className={selectClass}
            value={filters.kind}
            disabled={busy}
            onChange={(event) =>
              onFilter("kind", event.target.value as DocumentRepositoryFilters["kind"])
            }
          >
            <option value="">{intl.formatMessage(MESSAGES.kindAll)}</option>
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
          <FormattedMessage {...MESSAGES.uploadedFrom} />
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
          <FormattedMessage {...MESSAGES.uploadedTo} />
          <DatePicker
            id="documents-uploaded-to"
            value={filters.uploadedTo}
            disabled={busy}
            onChange={(value) => onFilter("uploadedTo", value)}
          />
        </label>
        {canManage && (
          <span className="flex h-8 items-center gap-2">
            <Label htmlFor="documents-show-archived">
              <FormattedMessage {...MESSAGES.showArchived} />
            </Label>
            <Switch
              id="documents-show-archived"
              checked={filters.includeArchived}
              disabled={busy}
              onCheckedChange={(next) => onFilter("includeArchived", next)}
            />
          </span>
        )}
        {error && (
          <p role="alert" className="text-xs text-status-danger-fg">
            {error}
          </p>
        )}
      </div>

      {chips.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={intl.formatMessage(MESSAGES.activeFilters)}
        >
          {chips.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex items-center gap-1 rounded-pill bg-subtle px-2 py-1 text-xs"
            >
              <span>
                <FormattedMessage
                  {...MESSAGES.chip}
                  values={{ name: filter.name, value: filter.value }}
                />
              </span>
              <button
                type="button"
                aria-label={intl.formatMessage(MESSAGES.remove, { name: filter.name })}
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
            aria-label={intl.formatMessage(MESSAGES.clearAllLabel)}
            disabled={busy}
            className="px-1 text-xs font-medium text-link hover:underline disabled:opacity-50"
            onClick={() => {
              setRecordDraft(null);
              setSearchOpen(false);
              onClear();
            }}
          >
            <FormattedMessage {...MESSAGES.clearAll} />
          </button>
          {empty && (
            <span className="sr-only" role="status">
              <FormattedMessage {...MESSAGES.matchedNone} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
