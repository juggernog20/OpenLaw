// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Documents · Matters / Contracts / Entities: DOC-015's three Document
 * type lists on the shared taxonomy editor. One page serves every tab,
 * as the Fields page does; the loader names the module. Knowledge has no
 * tab: its files show their item's Knowledge type.
 *
 * Fixed rows (the Contract negotiation types) wear the lock and cannot
 * be renamed. Archive keeps references: an archived type still labels
 * the Versions that carry it and only leaves the pickers.
 */
import { redirect, useLoaderData } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useState } from "react";
import { Check } from "lucide-react";
import { DOCUMENT_TYPE_COLORS, type DocumentTypeColor } from "@openlaw/shared";
import { Button } from "../components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";
import {
  documentTypeColorLabel,
  documentTypePill,
  type DocumentTypeOption,
} from "../lib/documents";
import { DocumentsSettingsTabs } from "../components/documents-settings-tabs";
import {
  TaxonomyTypesPane,
  type TaxonomyPaneApi,
  type TaxonomyPaneRow,
} from "../components/taxonomy-types-pane";
import { api } from "../lib/api";
import type { DocumentTypeModule } from "../lib/documents";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";

interface DocumentTypeRow extends TaxonomyPaneRow {
  systemKind: DocumentTypeOption["systemKind"];
  color: DocumentTypeColor | null;
}

/** Every module's routes share one shape, so one literal types them all. */
const base = (module: DocumentTypeModule) =>
  `/api/v1/documents/types/${module}` as "/api/v1/documents/types/contract";
const one = (module: DocumentTypeModule) =>
  `/api/v1/documents/types/${module}/{id}` as "/api/v1/documents/types/contract/{id}";

export function settingsDocumentsIndexLoader() {
  return redirect("/settings/documents/matters");
}

export function settingsDocumentTypesLoader(module: DocumentTypeModule) {
  return async () => {
    const user = await requireUser();
    if (user.role !== "administrator") return redirect("/settings/profile");
    const { data } = await api.GET(base(module), {
      params: { query: { includeArchived: "true" } },
    });
    if (!data) throw new Error("The document types could not be read.");
    return { module, documentTypes: data.documentTypes };
  };
}

const MESSAGES = defineMessages({
  pageTitle: { id: "settings.documentTypes.pageTitle", defaultMessage: "Document types" },
  title: { id: "settings.documentTypes.title", defaultMessage: "Document types" },
  count: {
    id: "settings.documentTypes.count",
    defaultMessage: "{count, plural, one {# type} other {# types}}",
  },
  add: { id: "settings.documentTypes.add", defaultMessage: "Add type" },
  addName: { id: "settings.documentTypes.addName", defaultMessage: "New type name" },
  help: {
    id: "settings.documentTypes.help",
    defaultMessage:
      "People pick a type when they upload a file, or leave it blank. Choose a colour for each type. Drag to reorder.",
  },
  renameLabel: { id: "settings.documentTypes.renameLabel", defaultMessage: "Rename {name}" },
  inUse: {
    id: "settings.documentTypes.inUse",
    defaultMessage: "{count, plural, one {# version} other {# versions}}",
  },
  archive: { id: "settings.documentTypes.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.documentTypes.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.documentTypes.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.documentTypes.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.documentTypes.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.documentTypes.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {No version uses {name}.} one {# version keeps {name} as its type.} " +
      "other {# versions keep {name} as their type.}} It leaves the upload pickers.",
  },
  reassignLabel: {
    id: "settings.documentTypes.reassignLabel",
    defaultMessage: "Reassign versions to",
  },
  reassignNone: { id: "settings.documentTypes.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.documentTypes.noCandidates",
    defaultMessage: "No other active type can take its versions.",
  },
  auditNote: {
    id: "settings.documentTypes.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.documentTypes.archiveError",
    defaultMessage: "The type could not be archived.",
  },
  archiveSubmit: { id: "settings.documentTypes.archiveSubmit", defaultMessage: "Archive type" },
  fixed: {
    id: "settings.documentTypes.fixed",
    defaultMessage: "{name} has a fixed name. Its colour can be changed.",
  },
});

function paneApi(module: DocumentTypeModule): TaxonomyPaneApi<DocumentTypeRow> {
  return {
    async create(displayName) {
      const result = await api.POST(base(module), { body: { displayName } }).catch(() => undefined);
      return { data: result?.data?.documentType, ...(await problem(result)) };
    },
    async rename(id, displayName) {
      const result = await api
        .PATCH(one(module), { params: { path: { id } }, body: { displayName } })
        .catch(() => undefined);
      return { data: result?.data?.documentType, ...(await problem(result)) };
    },
    async reorder(ids) {
      const result = await api
        .PUT(`${base(module)}/order` as "/api/v1/documents/types/contract/order", {
          body: { ids },
        })
        .catch(() => undefined);
      return { data: result?.data?.documentTypes, ...(await problem(result)) };
    },
    async archive(id) {
      const result = await api
        .POST(`${one(module)}/archive` as "/api/v1/documents/types/contract/{id}/archive", {
          params: { path: { id } },
          body: {},
        })
        .catch(() => undefined);
      return { data: result?.data?.documentType, ...(await problem(result)) };
    },
    async restore(id) {
      const result = await api
        .POST(`${one(module)}/restore` as "/api/v1/documents/types/contract/{id}/restore", {
          params: { path: { id } },
        })
        .catch(() => undefined);
      return { data: result?.data?.documentType, ...(await problem(result)) };
    },
  };
}

function DocumentTypeColorPicker({
  module,
  row,
  onSaved,
}: Readonly<{
  module: DocumentTypeModule;
  row: DocumentTypeRow;
  onSaved: (row: DocumentTypeRow) => void;
}>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = intl.formatMessage(
    {
      id: "settings.documentTypes.colorLabel",
      defaultMessage: "Colour for {name}",
    },
    { name: row.displayName },
  );

  async function save(color: DocumentTypeColor | null) {
    if (color === row.color) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api
        .PATCH(one(module), { params: { path: { id: row.id } }, body: { color } })
        .catch(() => undefined);
      if (result?.data) {
        onSaved(result.data.documentType);
        setOpen(false);
      } else {
        const failure = await problem(result);
        setError(
          failure.detail ??
            intl.formatMessage({
              id: "settings.documentTypes.colorError",
              defaultMessage: "The colour could not be saved. Try again.",
            }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          title={intl.formatMessage(
            {
              id: "settings.documentTypes.colorTitle",
              defaultMessage: "Colour for {name}: {color}",
            },
            { name: row.displayName, color: documentTypeColorLabel(intl, row.color) },
          )}
        >
          <span
            aria-hidden="true"
            className={`flex size-5 items-center justify-center rounded-full ${documentTypePill(row.systemKind ?? "general", row.color)}`}
          >
            <span className="size-3 rounded-full bg-current" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56" aria-label={label}>
        <p className="px-2 py-1 text-sm font-semibold">{label}</p>
        <div className="flex flex-col gap-1" aria-busy={busy}>
          {([null, ...DOCUMENT_TYPE_COLORS] as const).map((color) => (
            <button
              key={color ?? "automatic"}
              type="button"
              disabled={busy}
              aria-pressed={row.color === color}
              className={`flex min-h-8 items-center gap-2 rounded-button px-2 text-sm focus-visible:outline-2 focus-visible:outline-link disabled:opacity-50 ${documentTypePill(row.systemKind ?? "general", color)}`}
              onClick={() => void save(color)}
            >
              <span aria-hidden="true" className="size-3 rounded-full bg-current" />
              <span className="flex-1 text-start">{documentTypeColorLabel(intl, color)}</span>
              {row.color === color && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
        {busy && (
          <p role="status" className="px-2 pt-2 text-sm text-muted">
            <FormattedMessage
              id="settings.documentTypes.colorSaving"
              defaultMessage="Saving colour…"
            />
          </p>
        )}
        {error && (
          <p role="alert" className="px-2 pt-2 text-sm text-status-danger-fg">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SettingsDocumentTypesPage() {
  const { module, documentTypes } = useLoaderData() as {
    module: DocumentTypeModule;
    documentTypes: DocumentTypeRow[];
  };
  return (
    <TaxonomyTypesPane<DocumentTypeRow>
      // A tab switch is a new list, not an edit of the old one.
      key={module}
      initialRows={documentTypes}
      archiveKeepsReferences
      tabs={<DocumentsSettingsTabs />}
      protectedRow={{
        matches: (row) => (row as DocumentTypeRow).systemKind !== null,
        lockRename: true,
        label: MESSAGES.fixed,
      }}
      rowActions={(row, onSaved) => (
        <DocumentTypeColorPicker module={module} row={row} onSaved={onSaved} />
      )}
      api={paneApi(module)}
      messages={MESSAGES}
    />
  );
}
