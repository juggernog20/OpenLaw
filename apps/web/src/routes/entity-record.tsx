// SPDX-License-Identifier: AGPL-3.0-only

/** The Entity record shell and M27/4 Overview (ENT-001/ENT-002). */
import { useMemo, useState, type ReactNode } from "react";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Archive, ArchiveRestore, Building2, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import {
  ENTITY_STATUSES,
  readRegistry,
  STATUS_PILL,
  statusLabel,
  type EntityCustomFieldRefs,
  type EntityField,
  type EntityRow,
  type EntityStatus,
} from "../lib/entities";
import { useFieldCommit, type FieldStatus, type TextField } from "../lib/field-commit";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problem } from "../lib/problem";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { useActivityApplet } from "../components/activity/activity-applet";
import type { FieldReference } from "../components/custom-field-control";
import { EntityFieldsCard } from "../components/entities/entity-fields-card";
import { EntityGrantsDialog } from "../components/entities/entity-grants-dialog";
import { OfficersCard } from "../components/entities/officers-card";
import { ObligationsPanel } from "../components/entities/obligations-panel";
import { OwnershipCard } from "../components/entities/ownership-card";
import { RegistrationsCard } from "../components/entities/registrations-card";
import { ShareCapitalCard, type CapitalKey } from "../components/entities/share-capital-card";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { RecordApplets } from "../components/shell/record-applets";
import { RecordTabs } from "../components/shell/record-tabs";
import { StatusNote } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { DocumentsCard } from "../components/documents/documents-card";
import { DocPanel } from "../components/documents/doc-panel";
import { RecordContext } from "../components/record-context";
import { ConfidentialBanner } from "../components/confidential-banner";
import { ConfidentialMarker } from "../components/confidential-marker";
import { ConfidentialToggle } from "../components/confidential-toggle";
import { LinkedRecordsList } from "../components/linked-records-list";
import {
  documentLandingParams,
  readDocumentLanding,
  readRecordDocuments,
  type ContractDocument,
} from "../lib/documents";
import { readRecordFolders } from "../lib/folders";
import { ENTITY_LINKED_RECORD_SEAMS } from "../lib/linked-records";

const RECORD_TABS = ["ownership", "obligations", "documents", "contracts", "matters"] as const;
type EntityTab = "overview" | (typeof RECORD_TABS)[number];

export async function entityRecordLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/");
  const id = params.entityId!;
  if (params.tab && !RECORD_TABS.includes(params.tab as (typeof RECORD_TABS)[number])) {
    return redirect(`/entities/${id}`);
  }
  const [
    record,
    types,
    options,
    officers,
    registrations,
    registry,
    holdings,
    obligations,
    obligationOptions,
    counts,
  ] = await Promise.all([
    api.GET("/api/v1/entities/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/entities/types"),
    api.GET("/api/v1/entities/officer-roles"),
    api.GET("/api/v1/entities/{id}/officers", { params: { path: { id } } }),
    api.GET("/api/v1/entities/{id}/registrations", { params: { path: { id } } }),
    readRegistry(),
    api.GET("/api/v1/entities/{id}/holdings", { params: { path: { id } } }),
    api.GET("/api/v1/entities/{id}/obligations", { params: { path: { id } } }),
    api.GET("/api/v1/entities/obligation-options"),
    api.GET("/api/v1/entities/{id}/linked-record-counts", { params: { path: { id } } }),
  ]);
  if (
    !record.data ||
    !types.data ||
    !options.data ||
    !officers.data ||
    !registrations.data ||
    !registry.data ||
    !holdings.data ||
    !obligations.data ||
    !obligationOptions.data
  ) {
    throw new Error("The entity could not be read.");
  }
  const documentRecord = { entityType: "entity" as const, id };
  const [paper, folders] =
    params.tab === "documents"
      ? await Promise.all([
          readRecordDocuments(documentRecord, false, undefined, "root"),
          readRecordFolders(documentRecord),
        ])
      : [
          { ok: true as const, documents: [], nextCursor: null },
          { ok: true as const, folders: [] },
        ];
  if (!paper.ok || !folders.ok) throw new Error("The Entity paper could not be read.");
  const landingParams = documentLandingParams(request, params.tab);
  const documentLanding = landingParams
    ? await readDocumentLanding(documentRecord, landingParams.documentId, landingParams.versionId)
    : null;
  return {
    user,
    tab: (params.tab ?? "overview") as EntityTab,
    entity: record.data.entity,
    fields: record.data.fields,
    customFieldRefs: record.data.customFieldRefs,
    entityTypes: types.data.entityTypes,
    officerRoles: options.data.officerRoles,
    users: options.data.users,
    officers: officers.data.officers,
    registrations: registrations.data.registrations,
    entities: registry.data.entities,
    holdings: holdings.data,
    obligations: obligations.data.obligations,
    obligationOptions: obligationOptions.data,
    documents: paper.documents,
    documentCursor: paper.nextCursor,
    folders: folders.folders,
    documentLanding,
    documentFindQuery: landingParams?.findQuery ?? null,
    linkedCounts: counts.data ?? { contracts: 0, matters: 0 },
  };
}

type TextFieldKey =
  | "legalName"
  | "jurisdiction"
  | "registrationNumber"
  | "taxId"
  | "registeredAgent"
  | "registeredAddress";
type FieldKey =
  | TextFieldKey
  | CapitalKey
  | `field:${string}`
  | "entityTypeId"
  | "status"
  | "formedOn"
  | "isConfidential";

export function EntityRecordPage() {
  const loaded = useLoaderData<typeof entityRecordLoader>();
  const intl = useIntl();
  const [saved, setSaved] = useState<EntityRow>(loaded.entity);
  const [attachedFields, setAttachedFields] = useState<EntityField[]>(loaded.fields);
  const [refs, setRefs] = useState<EntityCustomFieldRefs>(loaded.customFieldRefs);
  const [drafts, setDrafts] = useState(() => textDrafts(loaded.entity));
  const [formedOn, setFormedOn] = useState(loaded.entity.formedOn ?? "");
  const commits = useFieldCommit<FieldKey>();
  const [archiveStatus, setArchiveStatus] = useState<FieldStatus>("idle");
  const [archiveError, setArchiveError] = useState<string>();
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [paper, setPaper] = useState(loaded.documents);
  const [paperCursor, setPaperCursor] = useState(loaded.documentCursor);
  const [folders, setFolders] = useState(loaded.folders);
  const [filed, setFiled] = useState<ContractDocument[]>([]);
  const [reading, setReading] = useState<{ documentId: string; versionId: string } | null>(() =>
    loaded.documentLanding
      ? {
          documentId: loaded.documentLanding.document.id,
          versionId: loaded.documentLanding.versionId,
        }
      : null,
  );
  // KeyedByParam remounts this page per Entity, not per tab, so a tab
  // change keeps the component while the loader answers again. Paper is
  // read only for the Documents tab, so seed the document state from
  // every fresh answer or the tab draws the first mount's empty list.
  // Done during render, React's own reset-on-prop-change shape.
  const [seededFrom, setSeededFrom] = useState(loaded);
  if (seededFrom !== loaded) {
    setSeededFrom(loaded);
    setPaper(loaded.documents);
    setPaperCursor(loaded.documentCursor);
    setFolders(loaded.folders);
    setFiled([]);
    setReading(
      loaded.documentLanding
        ? {
            documentId: loaded.documentLanding.document.id,
            versionId: loaded.documentLanding.versionId,
          }
        : null,
    );
  }
  const frozen = saved.archivedAt !== null;
  // Sort every holder, restricted ones included. When the largest stake
  // sits with a Restricted Entity the breadcrumb draws no owner crumb
  // (ENT-004) rather than promoting a smaller open holder to parent.
  const majorityOwner = loaded.holdings.owners.slice().sort(
    (a, b) =>
      b.ownershipPercent - a.ownershipPercent ||
      (!a.owner.restricted && !b.owner.restricted
        ? a.owner.legalName.localeCompare(b.owner.legalName, undefined, {
            sensitivity: "base",
          }) || a.owner.id.localeCompare(b.owner.id)
        : 0),
  )[0]?.owner;

  const people: FieldReference[] = mergeReferences(
    loaded.users.map((row) => ({ id: row.id, label: row.displayName })),
    refs.users.map((row) => ({ id: row.id, label: row.displayName, archived: row.archived })),
  );
  const entityRefs: FieldReference[] = mergeReferences(
    loaded.entities.map((row) => ({ id: row.id, label: row.legalName })),
    refs.entities.map((row) =>
      row.restricted
        ? {
            id: row.id,
            label: intl.formatMessage({
              id: "entities.restricted",
              defaultMessage: "Restricted Entity",
            }),
            restricted: true,
          }
        : { id: row.id, label: row.legalName, archived: row.archived },
    ),
  );
  const history = useActivityApplet({
    entityType: "entity",
    entityId: saved.id,
    fields: attachedFields,
    referenceNames: Object.fromEntries(
      [...people, ...entityRefs].map((row) => [row.id, row.label]),
    ),
  });
  const open = (() => {
    if (!reading) return null;
    const document = [
      ...paper,
      ...filed,
      ...(loaded.documentLanding ? [loaded.documentLanding.document] : []),
    ].find((row) => row.id === reading.documentId);
    const version = document?.versions.find((row) => row.id === reading.versionId);
    return document && version ? { document, version } : null;
  })();
  const recordFacts = useMemo(
    () => ({
      record: { kind: "entity" as const, id: saved.id, number: 0 },
      viewer: { id: loaded.user.id, role: loaded.user.role },
      ownerId: null,
      confidential: saved.isConfidential,
      canEdit: true,
      frozen,
    }),
    [saved.id, saved.isConfidential, loaded.user.id, loaded.user.role, frozen],
  );

  function commit(key: FieldKey, body: Record<string, unknown>) {
    return commits.commit(
      key,
      () => api.PATCH("/api/v1/entities/{id}", { params: { path: { id: saved.id } }, body }),
      (data) => {
        setSaved(data.entity);
        setAttachedFields(data.fields);
        setRefs(data.customFieldRefs);
        if (key === "formedOn") setFormedOn(data.entity.formedOn ?? "");
        if (isTextKey(key))
          setDrafts((current) => ({ ...current, [key]: textDrafts(data.entity)[key] }));
      },
    );
  }

  function textField(key: TextFieldKey): TextField {
    return {
      draft: drafts[key],
      saved: key === "legalName" ? saved.legalName : (saved[key] ?? ""),
      required: key === "legalName",
      reset: (value) => setDrafts((current) => ({ ...current, [key]: value })),
      send: (value) => commit(key, { [key]: key === "legalName" ? value : value || null }),
    };
  }

  const textInput = (key: TextFieldKey, id: string, label: ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={drafts[key]}
          disabled={frozen}
          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
          onBlur={() => commits.commitText(key, textField(key))}
          onKeyDown={(event) => {
            if (event.key === "Enter") commits.commitText(key, textField(key));
            if (event.key === "Escape") commits.revertText(key, textField(key));
          }}
        />
        <StatusNote status={commits.status[key] ?? "idle"} detail={commits.error[key]} />
      </div>
    </div>
  );

  async function archiveOrRestore() {
    setArchiveStatus("saving");
    const result = await (
      frozen
        ? api.POST("/api/v1/entities/{id}/restore", { params: { path: { id: saved.id } } })
        : api.POST("/api/v1/entities/{id}/archive", { params: { path: { id: saved.id } } })
    ).catch(() => undefined);
    if (!result?.data) {
      setArchiveStatus("error");
      setArchiveError((await problem(result)).detail);
      return;
    }
    setSaved(result.data.entity);
    setDrafts(textDrafts(result.data.entity));
    setFormedOn(result.data.entity.formedOn ?? "");
    setArchiveStatus("idle");
  }

  const signOut = useSignOut("/auth/login");
  return (
    <RecordContext.Provider value={recordFacts}>
      <AppShell
        user={loaded.user}
        onSignOut={() => void signOut()}
        recordScope={{ entityType: "entity", entityId: loaded.entity.id }}
        banner={
          saved.isConfidential ? (
            <ConfidentialBanner
              record="entity"
              manageTeamHref={
                loaded.user.role === "administrator"
                  ? `/entities/${saved.id}#entity-access`
                  : undefined
              }
            />
          ) : undefined
        }
        subbar={
          <>
            <section
              aria-labelledby="page-title"
              className="flex h-(--height-subbar) items-center justify-between gap-4 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Link to="/entities" className="text-link hover:underline">
                  <FormattedMessage id="entities.title" defaultMessage="Entities" />
                </Link>
                <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
                {majorityOwner && !majorityOwner.restricted ? (
                  <>
                    <Link
                      to={`/entities/${majorityOwner.id}`}
                      className="truncate text-link hover:underline"
                    >
                      {majorityOwner.legalName}
                    </Link>
                    <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
                  </>
                ) : null}
                <Building2 size={16} aria-hidden="true" className="text-muted" />
                <h1 id="page-title" className="truncate text-md font-semibold">
                  {saved.legalName}
                </h1>
                {saved.isConfidential ? <ConfidentialMarker /> : null}
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_PILL[saved.status]}`}
                >
                  {statusLabel(intl, saved.status)}
                </span>
                {frozen ? (
                  <span className="rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs">
                    <FormattedMessage id="entities.archivedPill" defaultMessage="Archived" />
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusNote status={archiveStatus} detail={archiveError} />
                <Button variant="secondary" onClick={() => void archiveOrRestore()}>
                  {frozen ? (
                    <>
                      <ArchiveRestore size={16} />
                      <FormattedMessage id="entities.record.restore" defaultMessage="Restore" />
                    </>
                  ) : (
                    <>
                      <Archive size={16} />
                      <FormattedMessage id="entities.record.archive" defaultMessage="Archive" />
                    </>
                  )}
                </Button>
              </div>
            </section>
            <RecordTabs
              label={intl.formatMessage({
                id: "entities.record.sections",
                defaultMessage: "Entity sections",
              })}
              tabs={recordTabs(intl, saved.id, loaded.linkedCounts)}
            />
          </>
        }
      >
        <PageTitle title={saved.legalName} />
        <RecordApplets
          applets={[history]}
          layer={
            open ? (
              <DocPanel
                documentId={open.document.id}
                title={open.document.title}
                version={open.version}
                initialFind={loaded.documentFindQuery}
                onClose={() => setReading(null)}
              />
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-page-x py-page-y">
            {loaded.tab === "overview" ? (
              <>
                {frozen ? (
                  <p className="rounded-card bg-status-warning-bg px-3 py-2 text-md text-status-warning-fg">
                    <FormattedMessage
                      id="entities.record.archivedNote"
                      defaultMessage="This entity is archived. Restore it to edit."
                    />
                  </p>
                ) : null}
                <section className="overflow-hidden rounded-card border border-border-default bg-raised">
                  <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
                    <h2 className="text-base font-semibold">
                      <FormattedMessage id="entities.record.registry" defaultMessage="Registry" />
                    </h2>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-2">
                    <div className="@2xl/page:col-span-2">
                      {textInput(
                        "legalName",
                        "entity-legal-name",
                        <FormattedMessage
                          id="entities.form.legalName"
                          defaultMessage="Legal name"
                        />,
                      )}
                    </div>
                    <SelectField
                      id="entity-type"
                      label={
                        <FormattedMessage id="entities.form.type" defaultMessage="Entity type" />
                      }
                      value={saved.entityTypeId}
                      disabled={frozen}
                      status={commits.status.entityTypeId}
                      error={commits.error.entityTypeId}
                      onChange={(value) => void commit("entityTypeId", { entityTypeId: value })}
                      options={loaded.entityTypes.map((row) => ({
                        value: row.id,
                        label: row.displayName,
                      }))}
                      fallback={{ value: saved.entityTypeId, label: saved.entityTypeName }}
                    />
                    <SelectField
                      id="entity-status"
                      label={<FormattedMessage id="entities.form.status" defaultMessage="Status" />}
                      value={saved.status}
                      disabled={frozen}
                      status={commits.status.status}
                      error={commits.error.status}
                      onChange={(value) => void commit("status", { status: value as EntityStatus })}
                      options={ENTITY_STATUSES.map((value) => ({
                        value,
                        label: statusLabel(intl, value),
                      }))}
                    />
                    {textInput(
                      "jurisdiction",
                      "entity-jurisdiction",
                      <FormattedMessage
                        id="entities.form.jurisdiction"
                        defaultMessage="Formation jurisdiction"
                      />,
                    )}
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="entity-formed-on">
                        <FormattedMessage id="entities.form.formedOn" defaultMessage="Formed on" />
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="entity-formed-on"
                          type="date"
                          value={formedOn}
                          disabled={frozen}
                          onChange={(event) => setFormedOn(event.target.value)}
                          onBlur={() => void commit("formedOn", { formedOn: formedOn || null })}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setFormedOn(saved.formedOn ?? "");
                          }}
                        />
                        <StatusNote
                          status={commits.status.formedOn ?? "idle"}
                          detail={commits.error.formedOn}
                        />
                      </div>
                    </div>
                    {textInput(
                      "registrationNumber",
                      "entity-registration-number",
                      <FormattedMessage
                        id="entities.form.registrationNumber"
                        defaultMessage="Registration no."
                      />,
                    )}
                    {textInput(
                      "taxId",
                      "entity-tax-id",
                      <FormattedMessage id="entities.form.taxId" defaultMessage="Tax ID" />,
                    )}
                    {textInput(
                      "registeredAgent",
                      "entity-registered-agent",
                      <FormattedMessage
                        id="entities.form.registeredAgent"
                        defaultMessage="Registered agent"
                      />,
                    )}
                    <div className="@2xl/page:col-span-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="entity-registered-address">
                          <FormattedMessage
                            id="entities.form.registeredAddress"
                            defaultMessage="Registered address"
                          />
                        </Label>
                        <div className="flex items-center gap-2">
                          <textarea
                            id="entity-registered-address"
                            value={drafts.registeredAddress}
                            className={TEXTAREA_CLASS}
                            disabled={frozen}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                registeredAddress: event.target.value,
                              }))
                            }
                            onBlur={() =>
                              commits.commitText(
                                "registeredAddress",
                                textField("registeredAddress"),
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                commits.revertText(
                                  "registeredAddress",
                                  textField("registeredAddress"),
                                );
                              }
                            }}
                          />
                          <StatusNote
                            status={commits.status.registeredAddress ?? "idle"}
                            detail={commits.error.registeredAddress}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                <section
                  id="entity-access"
                  className="overflow-hidden rounded-card border border-border-default bg-raised"
                >
                  <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
                    <h2 className="text-base font-semibold">
                      <FormattedMessage
                        id="entities.record.confidentiality"
                        defaultMessage="Confidentiality"
                      />
                    </h2>
                  </header>
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <ConfidentialToggle
                      id="entity-confidential"
                      record="entity"
                      confidential={saved.isConfidential}
                      disabled={frozen || loaded.user.role !== "administrator"}
                      status={
                        <StatusNote
                          status={commits.status.isConfidential ?? "idle"}
                          detail={commits.error.isConfidential}
                        />
                      }
                      onChange={(isConfidential) =>
                        void commit("isConfidential", { isConfidential })
                      }
                    />
                    {loaded.user.role === "administrator" ? (
                      <Button variant="secondary" onClick={() => setGrantsOpen(true)}>
                        <FormattedMessage
                          id="entities.confidential.manage"
                          defaultMessage="Manage access"
                        />
                      </Button>
                    ) : null}
                  </div>
                </section>
                <ShareCapitalCard
                  entity={saved}
                  frozen={frozen}
                  status={commits.status}
                  error={commits.error}
                  onCommit={(key, value) => void commit(key, { [key]: value })}
                />
                <EntityFieldsCard
                  entity={saved}
                  fields={attachedFields}
                  people={people}
                  entities={entityRefs}
                  frozen={frozen}
                  status={commits.status}
                  error={commits.error}
                  onCommit={(slug, value) =>
                    void commit(`field:${slug}`, { customFields: { [slug]: value } })
                  }
                />
                <OfficersCard
                  entityId={saved.id}
                  initial={loaded.officers}
                  roles={loaded.officerRoles}
                  users={loaded.users}
                  frozen={frozen}
                />
                <RegistrationsCard
                  entityId={saved.id}
                  initial={loaded.registrations}
                  obligations={loaded.obligations}
                  frozen={frozen}
                />
              </>
            ) : loaded.tab === "ownership" ? (
              <OwnershipCard
                entity={saved}
                candidates={loaded.entities}
                initial={loaded.holdings}
                frozen={frozen}
              />
            ) : loaded.tab === "obligations" ? (
              <ObligationsPanel
                entityId={saved.id}
                initial={loaded.obligations}
                registrations={loaded.registrations}
                options={loaded.obligationOptions}
                frozen={frozen}
              />
            ) : loaded.tab === "documents" ? (
              <DocumentsCard
                documents={paper}
                folders={folders}
                nextCursor={paperCursor}
                supportingUploads={false}
                reading={reading?.versionId ?? null}
                amending={null}
                onAmendmentOpened={() => undefined}
                onRead={(document, version) =>
                  setReading({ documentId: document.id, versionId: version.id })
                }
                onDocuments={(documents, cursor) => {
                  setPaper(documents);
                  if (cursor !== undefined) setPaperCursor(cursor);
                }}
                onFiled={setFiled}
                onFolders={setFolders}
              />
            ) : loaded.tab === "contracts" ? (
              <LinkedRecordsList
                key={`${saved.id}:contracts`}
                record={recordFacts.record}
                seam={ENTITY_LINKED_RECORD_SEAMS.contract}
              />
            ) : (
              <LinkedRecordsList
                key={`${saved.id}:matters`}
                record={recordFacts.record}
                seam={ENTITY_LINKED_RECORD_SEAMS.matter}
              />
            )}
          </div>
        </RecordApplets>
        <EntityGrantsDialog entityId={saved.id} open={grantsOpen} onOpenChange={setGrantsOpen} />
      </AppShell>
    </RecordContext.Provider>
  );
}

function SelectField({
  id,
  label,
  value,
  disabled,
  status,
  error,
  onChange,
  options,
  fallback,
}: {
  id: string;
  label: ReactNode;
  value: string;
  disabled: boolean;
  status?: FieldStatus;
  error?: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  fallback?: { value: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          className={CONTROL_CLASS}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {fallback && !options.some((row) => row.value === fallback.value) ? (
            <option value={fallback.value}>{fallback.label}</option>
          ) : null}
          {options.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
        <StatusNote status={status ?? "idle"} detail={error} />
      </div>
    </div>
  );
}

const TAB_LABELS: Readonly<Record<EntityTab, ReactNode>> = {
  overview: <FormattedMessage id="entities.record.tab.overview" defaultMessage="Overview" />,
  ownership: <FormattedMessage id="entities.record.tab.ownership" defaultMessage="Ownership" />,
  obligations: (
    <FormattedMessage id="entities.record.tab.obligations" defaultMessage="Obligations" />
  ),
  documents: <FormattedMessage id="entities.record.tab.documents" defaultMessage="Documents" />,
  contracts: <FormattedMessage id="entities.record.tab.contracts" defaultMessage="Contracts" />,
  matters: <FormattedMessage id="entities.record.tab.matters" defaultMessage="Matters" />,
};

const COUNT_LABELS = {
  contracts: defineMessage({
    id: "entities.record.tab.contracts.count",
    defaultMessage: "{count, plural, one {# linked Contract} other {# linked Contracts}}",
  }),
  matters: defineMessage({
    id: "entities.record.tab.matters.count",
    defaultMessage: "{count, plural, one {# linked Matter} other {# linked Matters}}",
  }),
} as const;

function recordTabs(intl: IntlShape, id: string, counts: { contracts: number; matters: number }) {
  return [
    { to: `/entities/${id}`, end: true, label: TAB_LABELS.overview },
    ...RECORD_TABS.map((tab) => {
      const counted = tab === "contracts" || tab === "matters";
      return {
        to: `/entities/${id}/${tab}`,
        label: TAB_LABELS[tab],
        count: counted ? counts[tab] : undefined,
        countLabel: counted
          ? intl.formatMessage(COUNT_LABELS[tab], { count: counts[tab] })
          : undefined,
      };
    }),
  ];
}

function textDrafts(row: EntityRow): Record<TextFieldKey, string> {
  return {
    legalName: row.legalName,
    jurisdiction: row.jurisdiction ?? "",
    registrationNumber: row.registrationNumber ?? "",
    taxId: row.taxId ?? "",
    registeredAgent: row.registeredAgent ?? "",
    registeredAddress: row.registeredAddress ?? "",
  };
}
function isTextKey(key: FieldKey): key is TextFieldKey {
  return [
    "legalName",
    "jurisdiction",
    "registrationNumber",
    "taxId",
    "registeredAgent",
    "registeredAddress",
  ].includes(key);
}
function mergeReferences(first: FieldReference[], second: FieldReference[]) {
  return [...first, ...second.filter((row) => !first.some((held) => held.id === row.id))];
}
