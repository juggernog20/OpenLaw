// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { defineMessages, useIntl } from "react-intl";
import {
  DOCUMENT_REPOSITORY_FORMATS,
  DOCUMENT_REPOSITORY_KINDS,
  documentKindLabel,
  documentRecordReference,
  FOLDER_ROOT,
  type DocumentRepositoryFilters,
  type DocumentRepositoryOptions,
} from "../../lib/documents";
import { pathOf, readRecordFolders, type ContractFolder } from "../../lib/folders";
import type { Layout } from "../../lib/list-views";
import { RecordFilterBar, type RecordFilter } from "../table/record-filter-bar";

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
  error,
  canManage,
  onChange,
}: Readonly<{
  filters: DocumentRepositoryFilters;
  options: DocumentRepositoryOptions;
  busy: boolean;
  error: string | null;
  canManage: boolean;
  onChange: (values: Layout["filters"]) => void;
}>) {
  const intl = useIntl();
  const selectedRecord = options.records.find((record) => record.reference === filters.record);
  const derivedOwner = filters.owner || selectedRecord?.kind;
  const folderKey = `${derivedOwner ?? ""}:${filters.record}`;
  const [folderAnswer, setFolderAnswer] = useState<{ key: string; rows: ContractFolder[] }>({
    key: "",
    rows: [],
  });
  const folders = folderAnswer.key === folderKey ? folderAnswer.rows : [];
  useEffect(() => {
    if (derivedOwner === "knowledge_item") return;
    const record = documentRecordReference(filters.record, derivedOwner || undefined);
    if (!record) return;
    let cancelled = false;
    void readRecordFolders(record).then((answer) => {
      if (!cancelled && answer.ok) setFolderAnswer({ key: folderKey, rows: answer.folders });
    });
    return () => {
      cancelled = true;
    };
  }, [derivedOwner, filters.record, folderKey]);

  const definitions: RecordFilter[] = [
    {
      key: "owner",
      label: intl.formatMessage({ id: "documents.filter.owner", defaultMessage: "Owner" }),
      kind: "choices",
      multiple: false,
      choices: [
        {
          id: "contract",
          displayName: intl.formatMessage({
            id: "documents.filter.owner.contracts",
            defaultMessage: "Contracts",
          }),
        },
        {
          id: "matter",
          displayName: intl.formatMessage({
            id: "documents.filter.owner.matters",
            defaultMessage: "Matters",
          }),
        },
        {
          id: "entity",
          displayName: intl.formatMessage({
            id: "documents.filter.owner.entities",
            defaultMessage: "Entities",
          }),
        },
        {
          id: "knowledge_item",
          displayName: intl.formatMessage({
            id: "documents.filter.owner.knowledge",
            defaultMessage: "Knowledge",
          }),
        },
      ],
    },
    {
      key: "record",
      label: intl.formatMessage({ id: "documents.filter.record", defaultMessage: "Record" }),
      kind: "choices",
      multiple: false,
      choices: options.records
        .filter((record) => !filters.owner || record.kind === filters.owner)
        .map((record) => ({
          id: record.reference,
          displayName:
            record.kind === "contract" || record.kind === "matter"
              ? `${record.reference} · ${record.title}`
              : record.title,
        })),
    },
    ...(filters.record && derivedOwner !== "knowledge_item"
      ? [
          {
            key: "folder",
            label: intl.formatMessage({ id: "documents.filter.folder", defaultMessage: "Folder" }),
            kind: "choices" as const,
            multiple: false,
            choices: [
              {
                id: FOLDER_ROOT,
                displayName: intl.formatMessage({
                  id: "documents.filter.folder.root",
                  defaultMessage: "Record root",
                }),
              },
              ...folders.map((folder) => ({
                id: folder.id,
                displayName: pathOf(folders, folder, "/"),
              })),
            ],
          },
        ]
      : []),
    {
      key: "format",
      label: intl.formatMessage({ id: "documents.filter.format", defaultMessage: "Format" }),
      kind: "choices",
      choices: DOCUMENT_REPOSITORY_FORMATS.map((id) => ({
        id,
        displayName: intl.formatMessage(FORMAT_MESSAGES[id]),
      })),
    },
    {
      key: "kind",
      label: intl.formatMessage({ id: "documents.filter.kind", defaultMessage: "Kind" }),
      kind: "choices",
      choices: DOCUMENT_REPOSITORY_KINDS.map((id) => ({
        id,
        displayName: documentKindLabel(intl, id),
      })),
    },
    {
      key: "counterparty",
      label: intl.formatMessage({
        id: "documents.filter.counterparty",
        defaultMessage: "Counterparty",
      }),
      kind: "choices",
      choices: options.counterparties.map((item) => ({ id: item.id, displayName: item.name })),
    },
    {
      key: "uploader",
      label: intl.formatMessage({ id: "documents.filter.uploader", defaultMessage: "Uploader" }),
      kind: "choices",
      choices: options.uploaders.map((item) => ({
        id: item.id,
        displayName: item.archived
          ? intl.formatMessage(
              { id: "documents.filter.uploader.archived", defaultMessage: "{name} (archived)" },
              { name: item.displayName },
            )
          : item.displayName,
      })),
    },
    {
      key: "uploaded",
      label: intl.formatMessage({ id: "documents.filter.uploaded", defaultMessage: "Uploaded" }),
      kind: "date",
    },
    ...(canManage
      ? [
          {
            key: "includeArchived",
            label: intl.formatMessage({
              id: "documents.showArchived",
              defaultMessage: "Show archived",
            }),
            kind: "flag" as const,
          },
        ]
      : []),
  ];
  return (
    <RecordFilterBar
      definitions={definitions}
      values={{ ...filters }}
      busy={busy}
      error={error}
      onChange={onChange}
    />
  );
}
