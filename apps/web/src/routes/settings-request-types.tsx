// SPDX-License-Identifier: AGPL-3.0-only

/** Request types and their destination Forms (INT-002, DD-028). */

import { redirect, useLoaderData } from "react-router";
import { defineMessages, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { IntakeSettingsTabs } from "../components/intake-settings-tabs";
import {
  TaxonomyTypesPane,
  type TaxonomyPaneApi,
  type TaxonomyPaneRow,
} from "../components/taxonomy-types-pane";

/** One request type on the pane: the shared row plus the target. */
interface RequestTypeRow extends TaxonomyPaneRow {
  targetModule: "matter" | "contract";
  targetTypeId: string | null;
}

/** The section URL forwards to its first pane (SET-001 deep links). */
export function settingsIntakeIndexLoader() {
  return redirect("/settings/intake/request-types");
}

export async function settingsRequestTypesLoader() {
  const user = await requireUser();
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
    defaultTypeNames: {
      contract: contractRes.data.contractTypes.find((type) => type.isDefault)?.displayName,
      matter: matterRes.data.matterTypes.find((type) => type.isDefault)?.displayName,
    },
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

const COLUMNS: Record<
  "nameColumn" | "destinationColumn" | "destinationPrefix" | "destinationType" | "defaultType",
  MessageDescriptor
> = defineMessages({
  nameColumn: { id: "settings.requestTypes.nameColumn", defaultMessage: "Request type" },
  destinationColumn: {
    id: "settings.requestTypes.destinationColumn",
    defaultMessage: "Destination",
  },
  destinationPrefix: {
    id: "settings.requestTypes.destinationPrefix",
    defaultMessage: "Destination:",
  },
  destinationType: {
    id: "settings.requestTypes.destinationType",
    defaultMessage: "{module, select, matter {Matter · {name}} other {Contract · {name}}}",
  },
  defaultType: { id: "settings.requestTypeEditor.defaultType", defaultMessage: "Default" },
});

/** The shared pane's API seam over the request-types routes. */
const PANE_API: TaxonomyPaneApi<RequestTypeRow> = {
  async create(displayName) {
    const result = await api
      .POST("/api/v1/request-types", { body: { displayName } })
      .catch(() => undefined);
    return { data: result?.data?.requestType, ...(await problem(result)) };
  },
  async rename(id, displayName) {
    const result = await api
      .PATCH("/api/v1/request-types/{id}", {
        params: { path: { id } },
        body: { displayName },
      })
      .catch(() => undefined);
    return { data: result?.data?.requestType, ...(await problem(result)) };
  },
  async reorder(ids) {
    const result = await api
      .PUT("/api/v1/request-types/order", { body: { ids } })
      .catch(() => undefined);
    return { data: result?.data?.requestTypes, ...(await problem(result)) };
  },
  async archive(id, reassignToId) {
    const result = await api
      .POST("/api/v1/request-types/{id}/archive", {
        params: { path: { id } },
        body: reassignToId ? { reassignToId } : {},
      })
      .catch(() => undefined);
    return { data: result?.data?.requestType, ...(await problem(result)) };
  },
  async restore(id) {
    const result = await api
      .POST("/api/v1/request-types/{id}/restore", {
        params: { path: { id } },
      })
      .catch(() => undefined);
    return { data: result?.data?.requestType, ...(await problem(result)) };
  },
};

export function SettingsRequestTypesPage() {
  const intl = useIntl();
  const { requestTypes, targetTypeNames, defaultTypeNames } =
    useLoaderData<typeof settingsRequestTypesLoader>();
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
            header: COLUMNS.destinationColumn,
            prefix: COLUMNS.destinationPrefix,
            width: "w-48",
            cell: (row) => (
              <FormattedMessage
                {...COLUMNS.destinationType}
                values={{
                  module: row.targetModule,
                  name:
                    (row.targetTypeId ? targetTypeNames[row.targetTypeId] : undefined) ??
                    defaultTypeNames[row.targetModule] ??
                    intl.formatMessage(COLUMNS.defaultType),
                }}
              />
            ),
          },
        ],
      }}
    />
  );
}
