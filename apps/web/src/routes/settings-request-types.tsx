// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Request types (#85), from the ST12 frame of settings.pen:
 * the INT-002 taxonomy on the shared TaxonomyTypesPane machinery — this
 * file owns the INT-002 vocabulary and the API adapter over the
 * request-types routes; the behavior lives in the shared component,
 * which is the point: the Intake pane is configuration, not a copy of
 * the Matters one. The loader is the client half of SET-002's gate; the
 * API's 403 is the real refusal.
 *
 * **The Target column and the two-line row are this mount's own.** They
 * take the place ST6 gives the in-use caption — which is why this mount
 * draws no caption: `requests` land in M20, so the count would read
 * "0 requests" on every row. The column reads the three states plainly:
 * "Contract · NDA", "Contract", "No target" — a request type whose
 * targeted type was hard-deleted has demoted to the module alone, and
 * the column says so without ceremony. ST12's **Form fields** column
 * joins them with the form definition (#355).
 *
 * Nothing here is system-protected. There is no fallback request type,
 * so a row an Administrator names "Other" archives and deletes like any
 * other — hence no `protectedRow`.
 */

import { redirect, useLoaderData } from "react-router";
import { defineMessages, FormattedMessage } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { IntakeSettingsTabs } from "../components/intake-settings-tabs";
import {
  TaxonomyTypesPane,
  type TaxonomyPaneApi,
  type TaxonomyPaneRow,
} from "../components/taxonomy-types-pane";

/** One request type on the pane: the shared row plus the target. */
interface RequestTypeRow extends TaxonomyPaneRow {
  targetModule: "matter" | "contract" | null;
  targetTypeId: string | null;
}

/** The section URL forwards to its first pane (SET-001 deep links). */
export function settingsIntakeIndexLoader() {
  return redirect("/settings/intake/request-types");
}

export async function settingsRequestTypesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [typesRes, matterRes, contractRes] = await Promise.all([
    api.GET("/api/v1/request-types", { params: { query: { includeArchived: "true" } } }),
    // The row carries the target's id; its name lives in the taxonomy
    // it points at. Archived rows ride along, because a target archived
    // after it was picked still has to read as itself.
    api.GET("/api/v1/matter-types", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/contract-types", { params: { query: { includeArchived: "true" } } }),
  ]);
  if (!typesRes.data || !matterRes.data || !contractRes.data) {
    throw new Error("The request types could not be read.");
  }
  return {
    requestTypes: typesRes.data.requestTypes,
    targetTypeNames: Object.fromEntries(
      [...matterRes.data.matterTypes, ...contractRes.data.contractTypes].map((row) => [
        row.id,
        row.displayName,
      ]),
    ),
  };
}

/** The INT-002 vocabulary over the shared pane's message slots. */
const MESSAGES = defineMessages({
  pageTitle: { id: "settings.requestTypes.pageTitle", defaultMessage: "Request types" },
  title: { id: "settings.requestTypes.title", defaultMessage: "Request types" },
  count: {
    id: "settings.requestTypes.count",
    defaultMessage: "{count, plural, one {# type} other {# types}}",
  },
  add: { id: "settings.requestTypes.add", defaultMessage: "Add request type" },
  addName: { id: "settings.requestTypes.addName", defaultMessage: "New request type name" },
  help: {
    id: "settings.requestTypes.help",
    defaultMessage:
      "Every form collects summary, description, attachments, and urgency. Attached " +
      "catalog fields carry their values into the converted matter or contract.",
  },
  renameLabel: { id: "settings.requestTypes.renameLabel", defaultMessage: "Rename {name}" },
  archive: { id: "settings.requestTypes.archive", defaultMessage: "Archive {name}" },
  restore: { id: "settings.requestTypes.restore", defaultMessage: "Restore {name}" },
  reorder: {
    id: "settings.requestTypes.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.requestTypes.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  archiveTitle: { id: "settings.requestTypes.archiveTitle", defaultMessage: "Archive {name}" },
  archiveWarning: {
    id: "settings.requestTypes.archiveWarning",
    defaultMessage:
      "{count, plural, =0 {{name} is not used by any requests — it can be " +
      "archived without reassignment.} one {{name} is used by # request. Pick a " +
      "replacement type — that request moves to it when the type is archived.} " +
      "other {{name} is used by # requests. Pick a replacement type — those " +
      "requests move to it when the type is archived.}}",
  },
  reassignLabel: {
    id: "settings.requestTypes.reassignLabel",
    defaultMessage: "Reassign {count, plural, =0 {requests} one {# request} other {# requests}} to",
  },
  reassignNone: { id: "settings.requestTypes.reassignNone", defaultMessage: "No reassignment" },
  noCandidates: {
    id: "settings.requestTypes.noCandidates",
    defaultMessage:
      "No other active type can take its requests. Add or restore another type first.",
  },
  auditNote: {
    id: "settings.requestTypes.auditNote",
    defaultMessage: "The change applies immediately and is recorded in the audit log.",
  },
  archiveError: {
    id: "settings.requestTypes.archiveError",
    defaultMessage: "The type could not be archived.",
  },
  archiveSubmit: { id: "settings.requestTypes.archiveSubmit", defaultMessage: "Archive type" },
  edit: { id: "settings.requestTypes.edit", defaultMessage: "Edit {name}" },
});

/** ST12's two mount-specific column heads and the Target cell's three
 * states. "Contract · NDA" names a type; "Contract" is the module
 * alone, which is where a hard-deleted target type leaves the row. */
const COLUMNS = defineMessages({
  nameColumn: { id: "settings.requestTypes.nameColumn", defaultMessage: "Request type" },
  targetColumn: { id: "settings.requestTypes.targetColumn", defaultMessage: "Target" },
  targetPrefix: { id: "settings.requestTypes.targetPrefix", defaultMessage: "Target:" },
  targetModule: {
    id: "settings.requestTypes.targetModule",
    defaultMessage: "{module, select, matter {Matter} contract {Contract} other {No target}}",
  },
  targetType: {
    id: "settings.requestTypes.targetType",
    defaultMessage:
      "{module, select, matter {Matter · {name}} contract {Contract · {name}} other {{name}}}",
  },
});

/** The shared pane's API seam over the request-types routes. */
const PANE_API: TaxonomyPaneApi<RequestTypeRow> = {
  async create(displayName) {
    const { data, error } = await api.POST("/api/v1/request-types", { body: { displayName } });
    return { data: data?.requestType, detail: problemDetail(error) };
  },
  async rename(id, displayName) {
    const { data, error } = await api.PATCH("/api/v1/request-types/{id}", {
      params: { path: { id } },
      body: { displayName },
    });
    return { data: data?.requestType, detail: problemDetail(error) };
  },
  async reorder(ids) {
    const { data, error } = await api.PUT("/api/v1/request-types/order", { body: { ids } });
    return { data: data?.requestTypes, detail: problemDetail(error) };
  },
  async archive(id, reassignToId) {
    const { data, error } = await api.POST("/api/v1/request-types/{id}/archive", {
      params: { path: { id } },
      body: reassignToId ? { reassignToId } : {},
    });
    return { data: data?.requestType, detail: problemDetail(error) };
  },
  async restore(id) {
    const { data, error } = await api.POST("/api/v1/request-types/{id}/restore", {
      params: { path: { id } },
    });
    return { data: data?.requestType, detail: problemDetail(error) };
  },
};

export function SettingsRequestTypesPage() {
  const { requestTypes, targetTypeNames } = useLoaderData<typeof settingsRequestTypesLoader>();
  return (
    <TaxonomyTypesPane<RequestTypeRow>
      initialRows={requestTypes}
      tabs={<IntakeSettingsTabs />}
      api={PANE_API}
      messages={MESSAGES}
      editor={{ path: (row) => `/settings/intake/request-types/${row.id}`, label: MESSAGES.edit }}
      columns={{
        name: COLUMNS.nameColumn,
        description: true,
        meta: [
          {
            header: COLUMNS.targetColumn,
            prefix: COLUMNS.targetPrefix,
            width: "w-40",
            cell: (row) => {
              const name = row.targetTypeId ? targetTypeNames[row.targetTypeId] : undefined;
              // No name means the module alone — either it was never
              // given a type, or the type it named was hard-deleted and
              // the FK demoted the row rather than stranding it.
              return name === undefined ? (
                <FormattedMessage {...COLUMNS.targetModule} values={{ module: row.targetModule }} />
              ) : (
                <FormattedMessage
                  {...COLUMNS.targetType}
                  values={{ module: row.targetModule, name }}
                />
              );
            },
          },
        ],
      }}
    />
  );
}
