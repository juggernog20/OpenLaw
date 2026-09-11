// SPDX-License-Identifier: AGPL-3.0-only

/** M22/5's editable matter record: one commit per field and recoverable lifecycle acts. */
import { subscribeLiveEvents } from "../lib/events";
import { MatterConversionValue } from "../components/intake/matter-conversion-value";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Briefcase, ChevronRight, Settings } from "lucide-react";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import {
  Link,
  redirect,
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import { MATTER_REOPEN_CONFIRMATION_PROBLEM_TYPE } from "@openlaw/shared";
import { api } from "../lib/api";
import { readRegistry } from "../lib/entities";
import {
  commitsOnChange,
  isAnswered,
  sameDraft,
  toDraft,
  toValue,
  unansweredRequired,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../lib/custom-fields";
import { formatFullDate } from "../lib/format";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import {
  MATTER_SEVERITIES,
  matterStatusPill,
  matterReference,
  matterSeverityLabel,
  type MatterField,
  type MatterLifecycle,
  type MatterRow,
  type MatterTeamMember,
  type MatterTypeOption,
} from "../lib/matters";
import { problem } from "../lib/problem";
import {
  documentLandingParams,
  previousComparableVersion,
  readDocumentLanding,
  type ContractDocument,
} from "../lib/documents";
import { canReadMatters, isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { ConfidentialBanner } from "../components/confidential-banner";
import { ConfidentialToggle } from "../components/confidential-toggle";
import { useActivityApplet } from "../components/activity/activity-applet";
import { useCommentApplet } from "../components/comments/comment-applet";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import { useMatterTeamApplet } from "../components/matters/team-applet";
import type { Applet } from "../components/shell/applets";
import { MatterKeyDatesCard } from "../components/matters/key-dates-card";
import { MatterTasksCard } from "../components/matters/tasks-card";
import { RelatedMattersCard } from "../components/matters/related-matters-card";
import { MatterStatusProgression } from "../components/matters/matter-status-progression";
import { LinkedContractsCard } from "../components/matters/linked-contracts-card";
import { CreateMatterDialog } from "../components/matters/create-matter-dialog";
import { DocPanel } from "../components/documents/doc-panel";
import { DocumentsCard } from "../components/documents/documents-card";
import { PageTitle } from "../components/page-title";
import { RecordNotFoundPage, type RecordNotFound } from "./not-found";
import { AppShell } from "../components/shell/app-shell";
import { RecordApplets } from "../components/shell/record-applets";
import { RecordTabs } from "../components/shell/record-tabs";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { RecordActionsMenu } from "../components/contracts/record-actions-menu";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { AutoResizeTextarea } from "../components/auto-resize-textarea";
import { Label } from "../components/ui/label";
import { RecordContext, type RecordFacts } from "../components/record-context";

/** The DES-032 sections a matter record has beyond its Overview. Each
 * is one trailing URL segment; the bare address is the Overview. */
const SETTINGS_APPLET: Applet = {
  id: "settings",
  icon: Settings,
  label: defineMessage({ id: "matters.applet.settings", defaultMessage: "Matter settings" }),
  group: "below-divider",
  href: "/settings/matters/types",
};

const RECORD_TABS = ["documents", "key-dates", "tasks"] as const;
type RecordTabName = "overview" | (typeof RECORD_TABS)[number];

export async function matterRecordLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!canReadMatters(user.role)) return redirect("/");
  const number = Number(params.matterNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error("That is not a matter reference.");
  // A section this record does not have is not an error. The record
  // exists. It lands on the Overview, which is what the bare address
  // already means (DES-032).
  if (params.tab && !RECORD_TABS.includes(params.tab as (typeof RECORD_TABS)[number])) {
    return redirect(`/matters/${number}`);
  }
  const canEdit = isMemberPlus(user.role);
  const landingTarget = documentLandingParams(request, params.tab);
  const [
    record,
    options,
    entities,
    relations,
    linkedContracts,
    paper,
    folders,
    keyDates,
    tasks,
    documentLanding,
  ] = await Promise.all([
    api.GET("/api/v1/matters/{number}", { params: { path: { number } } }),
    canEdit ? api.GET("/api/v1/matters/options") : undefined,
    canEdit ? readRegistry().catch(() => ({ data: undefined })) : undefined,
    api.GET("/api/v1/matters/{number}/relations", { params: { path: { number } } }),
    api.GET("/api/v1/matters/{number}/contracts", { params: { path: { number } } }),
    api
      .GET("/api/v1/matters/{number}/documents", {
        params: { path: { number }, query: { folder: "root" } },
      })
      .catch(() => ({ data: undefined })),
    api
      .GET("/api/v1/matters/{number}/folders", { params: { path: { number } } })
      .catch(() => ({ data: undefined })),
    api.GET("/api/v1/matters/{number}/key-dates", { params: { path: { number } } }),
    api.GET("/api/v1/matters/{number}/tasks", { params: { path: { number } } }),
    landingTarget
      ? readDocumentLanding(
          { entityType: "matter", number },
          landingTarget.documentId,
          landingTarget.versionId,
        )
      : Promise.resolve(null),
  ]);
  // A number nobody holds and a Matter this viewer cannot open are the
  // same 404 (DD-013, DD-014). Both draw a page that says so; every
  // other failure still throws to the error boundary.
  if (record.response.status === 404) return { notFound: true as const, user, number };
  if (!record.data || !relations.data || !linkedContracts.data || !keyDates.data || !tasks.data) {
    throw new Error("The matter could not be read.");
  }
  if (canEdit && !options?.data) {
    throw new Error("The matter's edit options could not be read.");
  }
  return {
    user,
    matter: record.data.matter,
    fields: record.data.fields,
    customFieldRefs: record.data.customFieldRefs,
    // Keep older cached/stubbed envelopes readable across the M22/5
    // deployment boundary; the server always supplies this now.
    team: record.data.team ?? [],
    matterTypes: options?.data?.matterTypes ?? [],
    matterStatuses: options?.data?.matterStatuses ?? [],
    users: options?.data?.users ?? [],
    entities: entities?.data?.entities ?? [],
    relations: relations.data,
    linkedContracts: linkedContracts.data.contracts,
    documents: paper.data?.documents ?? [],
    documentsCursor: paper.data?.nextCursor ?? null,
    folders: folders.data?.folders ?? [],
    deadlines: keyDates.data.deadlines,
    tasks: tasks.data.tasks,
    taskDoneCount: tasks.data.doneCount,
    taskTotalCount: tasks.data.totalCount,
    documentLanding,
    documentFindQuery: documentLanding ? (landingTarget?.findQuery ?? null) : null,
  };
}

function notProvided(intl: IntlShape): string {
  return intl.formatMessage({ id: "matters.notProvided", defaultMessage: "Not provided" });
}

type FieldKey =
  | "title"
  | "description"
  | "matterTypeId"
  | "managerId"
  | "priority"
  | "risk"
  | "statusId"
  | "isConfidential"
  | `field:${string}`;

type MatterRecordData = Exclude<
  ReturnType<typeof useLoaderData<typeof matterRecordLoader>>,
  RecordNotFound
>;

export function MatterRecordPage() {
  const loaded = useLoaderData<typeof matterRecordLoader>();
  const intl = useIntl();
  if (loaded.notFound) {
    return (
      <RecordNotFoundPage
        user={loaded.user}
        title={intl.formatMessage({
          id: "notFound.matter.title",
          defaultMessage: "Matter not found",
        })}
        body={
          <FormattedMessage
            id="notFound.matter.body"
            defaultMessage="{reference} does not exist, or you cannot open it."
            values={{ reference: matterReference(intl, loaded.number) }}
          />
        }
        backTo="/matters"
        backLabel={<FormattedMessage id="notFound.matter.back" defaultMessage="Back to Matters" />}
      />
    );
  }
  return <MatterRecord />;
}

function MatterRecord() {
  const loader = useLoaderData() as MatterRecordData;
  const { user, matterTypes, matterStatuses, users } = loader;
  const intl = useIntl();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(loader.matter);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLiveEvents((event) => {
      if (
        event.kind !== "record" ||
        event.entityType !== "matter" ||
        event.entityId !== saved.id ||
        ![
          "matter.field_confirmed",
          "matter.updated",
          "key_date.edited",
          "key_date.removed",
        ].includes(event.action)
      )
        return;
      void api
        .GET("/api/v1/matters/{number}", { params: { path: { number: saved.number } } })
        .then(({ data }) => {
          if (active && data)
            setSaved((current) => ({ ...current, aiUnverified: data.matter.aiUnverified }));
        })
        .catch(() => {});
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [saved.id, saved.number]);

  const confirmedConversion = (slug: string) =>
    setSaved((current) => {
      const flags = { ...current.aiUnverified };
      delete flags[slug];
      return { ...current, aiUnverified: Object.keys(flags).length ? flags : null };
    });

  const [fields, setFields] = useState(loader.fields);
  const [customFieldRefs, setCustomFieldRefs] = useState(loader.customFieldRefs);
  const [team, setTeam] = useState<MatterTeamMember[]>(loader.team);
  const [relations, setRelations] = useState(loader.relations);
  const [linkedContracts, setLinkedContracts] = useState(loader.linkedContracts);
  const [subMatterOpen, setSubMatterOpen] = useState(false);
  // Which section is on screen (DES-032). The loader has already sent
  // an unknown segment back to the bare address, so the cast is safe.
  const tab = (useParams().tab ?? "overview") as RecordTabName;
  const [paper, setPaper] = useState(loader.documents);
  const [paperCursor, setPaperCursor] = useState(loader.documentsCursor);
  const [folders, setFolders] = useState(loader.folders);
  const [deadlines, setDeadlines] = useState(loader.deadlines);
  const [checklist, setChecklist] = useState({
    tasks: loader.tasks,
    doneCount: loader.taskDoneCount,
    totalCount: loader.taskTotalCount,
  });
  const [filed, setFiled] = useState<typeof loader.documents>(() =>
    loader.documentLanding &&
    !loader.documents.some((document) => document.id === loader.documentLanding?.document.id)
      ? [loader.documentLanding.document]
      : [],
  );
  const [reading, setReading] = useState<{ documentId: string; versionId: string } | null>(() =>
    loader.documentLanding
      ? {
          documentId: loader.documentLanding.document.id,
          versionId: loader.documentLanding.versionId,
        }
      : null,
  );
  const readingDocked = useRef(true);
  const [readingCovers, setReadingCovers] = useState(false);
  useEffect(() => {
    if (reading === null) readingDocked.current = true;
  }, [reading]);

  // A covering reader must give way to the section the person selected.
  // A docked reader can stay beside it, as on Contracts.
  useEffect(() => {
    if (readingDocked.current) return;
    setReading(null);
    setReadingCovers(false);
    readingDocked.current = true;
  }, [tab]);

  const location = useLocation();
  const landedNavigation = useRef(location.key);
  useEffect(() => {
    if (landedNavigation.current === location.key) return;
    landedNavigation.current = location.key;
    const target = loader.documentLanding;
    if (!target) return;
    // Apply a completed navigation once; background revalidation must not reopen the reader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPaper((rows) => rows.map((row) => (row.id === target.document.id ? target.document : row)));
    setFiled((rows) => [...rows.filter((row) => row.id !== target.document.id), target.document]);
    setReading({ documentId: target.document.id, versionId: target.versionId });
    setReadingCovers(false);
    readingDocked.current = true;
  }, [location.key, loader.documentLanding]);

  function closeReading() {
    setReading(null);
    setReadingCovers(false);
    readingDocked.current = true;
  }
  const [title, setTitle] = useState(saved.title);
  const [description, setDescription] = useState(saved.description ?? "");
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<FieldKey, FieldStatus>>>({});
  const [fieldError, setFieldError] = useState<Partial<Record<FieldKey, string | undefined>>>({});
  const [retypeTo, setRetypeTo] = useState<MatterTypeOption | null>(null);
  const [lifecycleDialog, setLifecycleDialog] = useState<"archive" | "restore" | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState<FieldStatus>("idle");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [matterLifecycle, setMatterLifecycle] = useState<MatterLifecycle | null>(null);
  const [matterClosingNote, setMatterClosingNote] = useState("");
  const [matterLifecycleStatusId, setMatterLifecycleStatusId] = useState("");
  const [matterLifecycleStatus, setMatterLifecycleStatus] = useState<FieldStatus>("idle");
  const [matterLifecycleError, setMatterLifecycleError] = useState<string | null>(null);
  const canEdit = isMemberPlus(user.role);
  const contributor = user.role === "contributor";
  const archived = saved.archivedAt !== null;
  const frozen = !canEdit || archived;
  /** DD-015's business-owned seams stay writable on a live record for
   * a Contributor who reached it; legal-managed details keep frozen. */
  const businessFrozen = archived || (!canEdit && !contributor);
  const canManageAudience =
    user.role === "administrator" ||
    saved.manager?.id === user.id ||
    team.some((member) => member.id === user.id && member.role === "creator");
  const audienceLocked = saved.isConfidential && !canManageAudience;
  const people = useMemo<FieldReference[]>(
    () =>
      users.map((person) => ({
        id: person.id,
        label: person.displayName,
        archived: person.archived,
      })),
    [users],
  );
  const heldPeople = customFieldRefs.users.map((person) => ({
    id: person.id,
    label: person.displayName,
    archived: person.archived,
  }));
  const peopleRefs = [
    ...people,
    ...heldPeople.filter((held) => !people.some((row) => row.id === held.id)),
  ];
  /** The Entities a Field may newly name, in the order the registry
   * read answered them. The registry is read once, when the page
   * loads, but every commit answers with fresh references. A reference
   * that comes back sealed or archived is the later word about that
   * Entity, so its stale registry row is dropped here rather than
   * offered as a choice under a name the viewer may no longer reach. */
  const liveEntities = useMemo<FieldReference[]>(() => {
    const overtaken = new Set(
      customFieldRefs.entities
        .filter((entity) => entity.restricted || entity.archived)
        .map((entity) => entity.id),
    );
    return loader.entities
      .filter((entity) => entity.archivedAt === null && !overtaken.has(entity.id))
      .map((entity) => ({ id: entity.id, label: entity.legalName }));
  }, [loader.entities, customFieldRefs]);
  /** One Field's choices: the registry, plus its own saved reference
   * when the registry left that out. An archived Entity stays
   * selectable as itself, and a restricted one keeps its mask
   * (DD-016). The saved reference belongs to the Field that holds it,
   * so it never becomes a choice on a Field beside it. */
  function entityChoices(value: CustomFieldValue | undefined): readonly FieldReference[] {
    const held = customFieldRefs.entities.find((entity) => entity.id === value);
    if (!held || liveEntities.some((choice) => choice.id === held.id)) return liveEntities;
    return [
      ...liveEntities,
      held.restricted
        ? {
            id: held.id,
            label: intl.formatMessage({
              id: "entities.restricted",
              defaultMessage: "Restricted Entity",
            }),
            restricted: true,
          }
        : { id: held.id, label: held.legalName, archived: held.archived },
    ];
  }
  const taskAssignees = useMemo(() => {
    const candidates = [
      ...(saved.manager && !saved.manager.archived ? [saved.manager] : []),
      ...team.filter(
        (person) =>
          !person.archived &&
          users.some((user) => user.id === person.id && user.role !== "business_user"),
      ),
    ];
    return [...new Map(candidates.map((person) => [person.id, person])).values()];
  }, [saved.manager, team, users]);

  const signOut = useSignOut("/auth/login");

  function note(key: FieldKey, status: FieldStatus, detail?: string) {
    setFieldStatus((current) => ({ ...current, [key]: status }));
    setFieldError((current) => ({ ...current, [key]: detail }));
  }

  async function commit(key: FieldKey, body: Record<string, unknown>) {
    note(key, "saving");
    const result = await api
      .PATCH("/api/v1/matters/{number}", {
        params: { path: { number: saved.number } },
        body,
      })
      .catch(() => undefined);
    if (!result?.data) {
      const refusal = await problem(result);
      if (
        key === "statusId" &&
        body.confirmReopen !== true &&
        refusal.type === MATTER_REOPEN_CONFIRMATION_PROBLEM_TYPE &&
        typeof body.statusId === "string"
      ) {
        note(key, "idle");
        await openMatterLifecycle(body.statusId);
        return undefined;
      }
      const detail = refusal.detail;
      note(key, "error", detail);
      return (
        detail ??
        intl.formatMessage({
          id: "matters.edit.error",
          defaultMessage: "The change could not be saved.",
        })
      );
    }
    const data = result.data;
    setSaved(data.matter);
    setFields(data.fields);
    setCustomFieldRefs(data.customFieldRefs);
    setTeam(data.team);
    if (key === "title") setTitle(data.matter.title);
    if (key === "description") setDescription(data.matter.description ?? "");
    note(key, "saved");
    return undefined;
  }

  function commitText(key: "title" | "description") {
    if (fieldStatus[key] === "saving") return;
    const draft = (key === "title" ? title : description).trim();
    const current = key === "title" ? saved.title : (saved.description ?? "");
    if (draft === current || (key === "title" && draft === "")) {
      if (key === "title") setTitle(saved.title);
      else setDescription(saved.description ?? "");
      return;
    }
    void commit(key, { [key]: key === "title" ? draft : draft || null });
  }

  function pickType(id: string) {
    const target = matterTypes.find((option) => option.id === id);
    if (!target || target.id === saved.matterTypeId) return;
    if (unansweredRequired(target.fields, saved.customFields).length === 0) {
      void commit("matterTypeId", { matterTypeId: id });
    } else {
      setRetypeTo(target);
    }
  }

  const renaming = useRef(false);
  function focusTitle() {
    const input = document.getElementById("matter-title");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }
  function startRename() {
    if (tab === "overview") focusTitle();
    else {
      renaming.current = true;
      void navigate(`/matters/${saved.number}`);
    }
  }
  useEffect(() => {
    if (!renaming.current || tab !== "overview") return;
    renaming.current = false;
    focusTitle();
  }, [tab]);

  async function archiveOrRestore() {
    const action = lifecycleDialog;
    if (!action || lifecycleStatus === "saving") return;
    setLifecycleStatus("saving");
    setLifecycleError(null);
    const result =
      action === "archive"
        ? await api
            .POST("/api/v1/matters/{number}/archive", {
              params: { path: { number: saved.number } },
            })
            .catch(() => undefined)
        : await api
            .POST("/api/v1/matters/{number}/restore", {
              params: { path: { number: saved.number } },
            })
            .catch(() => undefined);
    if (!result?.data) {
      setLifecycleStatus("error");
      setLifecycleError((await problem(result)).detail ?? null);
      return;
    }
    setSaved(result.data.matter);
    setLifecycleStatus("saved");
    setLifecycleDialog(null);
  }

  async function openMatterLifecycle(preferredStatusId: string) {
    if (matterLifecycleStatus === "saving") return;
    setMatterLifecycleStatus("saving");
    setMatterLifecycleError(null);
    const result = await api
      .GET("/api/v1/matters/{number}/lifecycle", {
        params: { path: { number: saved.number } },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setMatterLifecycleStatus("error");
      setMatterLifecycleError((await problem(result)).detail ?? null);
      return;
    }
    const data = result.data;
    if (!data.statuses.some((status) => status.id === preferredStatusId)) {
      setMatterLifecycleStatus("error");
      setMatterLifecycleError(
        intl.formatMessage({
          id: "matters.status.unavailable",
          defaultMessage: "That status is no longer available. Choose another status.",
        }),
      );
      return;
    }
    setMatterLifecycle(data);
    setMatterLifecycleStatusId(preferredStatusId);
    setMatterClosingNote("");
    setMatterLifecycleStatus("idle");
  }

  async function commitMatterLifecycle() {
    if (
      !matterLifecycleStatusId ||
      matterLifecycleStatus === "saving" ||
      (matterLifecycle?.action === "close" && !matterClosingNote.trim())
    )
      return;
    setMatterLifecycleStatus("saving");
    setMatterLifecycleError(null);
    const refusal = await commit("statusId", {
      statusId: matterLifecycleStatusId,
      ...(matterLifecycle?.action === "reopen" ? { confirmReopen: true } : {}),
      ...(matterLifecycle?.action === "close" ? { closingNote: matterClosingNote.trim() } : {}),
    });
    if (refusal) {
      setMatterLifecycleStatus("error");
      setMatterLifecycleError(refusal);
      return;
    }
    setMatterLifecycleStatus("idle");
    setMatterLifecycle(null);
  }

  // The saved type, status, or Matter Manager may have been archived
  // since the options were read. Keep each selectable as itself, or the
  // select shows its first option and the record lies about what it holds.
  const typeOptions = matterTypes.some((option) => option.id === saved.matterTypeId)
    ? matterTypes
    : [
        {
          id: saved.matterTypeId,
          slug: saved.matterTypeId,
          displayName: saved.matterTypeName,
          fields,
        },
        ...matterTypes,
      ];
  const statusOptions = matterStatuses.some((option) => option.id === saved.statusId)
    ? matterStatuses
    : [
        {
          id: saved.statusId,
          slug: saved.statusId,
          displayName: saved.statusName,
          category: saved.statusCategory,
          progressionGroup: saved.statusProgressionGroup,
        },
        ...matterStatuses,
      ];
  const managerOptions = users.filter(
    (person) => person.role === "administrator" || person.role === "legal_team_member",
  );
  const heldManager =
    saved.manager && !managerOptions.some((person) => person.id === saved.manager!.id)
      ? [saved.manager]
      : [];
  const teamApplet = useMatterTeamApplet({
    number: saved.number,
    manager: saved.manager,
    team,
    users,
    frozen,
    audienceLocked,
    onTeam: setTeam,
  });
  const loadFilingDocuments = useCallback(async () => {
    const rows: ContractDocument[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page += 1) {
      const { data } = await api.GET("/api/v1/matters/{number}/documents", {
        params: { path: { number: saved.number }, query: { cursor } },
      });
      if (!data) throw new Error("Could not read Matter documents");
      rows.push(...data.documents);
      if (!data.nextCursor) return rows;
      if (seen.has(data.nextCursor)) throw new Error("Repeated document cursor");
      seen.add(data.nextCursor);
      cursor = data.nextCursor;
    }
    throw new Error("Document page limit");
  }, [saved.number]);
  const refreshFiledPaper = useCallback(async () => {
    const documents = await loadFilingDocuments();
    setPaper(documents.filter((document) => document.folderId === null));
    setPaperCursor(null);
    setFiled(documents.filter((document) => document.folderId !== null));
  }, [loadFilingDocuments]);
  const filingContext = useMemo(
    () => ({
      documents: [...paper, ...filed].map(({ id, title }) => ({ id, title })),
      loadDocuments: loadFilingDocuments,
      recordHref: `/matters/${saved.number}/documents`,
      canFile: isMemberPlus(user.role) && !frozen,
      onOpen: (documentId: string, versionId: string) => {
        const document = [...paper, ...filed].find((row) => row.id === documentId);
        if (!document?.versions.some((version) => version.id === versionId)) return false;
        setReading({ documentId, versionId });
        return true;
      },
      onPaperFiled: refreshFiledPaper,
    }),
    [paper, filed, loadFilingDocuments, saved.number, user.role, frozen, refreshFiledPaper],
  );
  const chatApplet = useCommentApplet({
    entityType: "matter",
    entityId: saved.id,
    role: user.role,
    viewerId: user.id,
    confidential: saved.isConfidential,
    filing: filingContext,
  });
  const historyApplet = useActivityApplet({
    entityType: "matter",
    entityId: saved.id,
    confidential: saved.isConfidential,
    fields,
    referenceNames: Object.fromEntries([
      ...peopleRefs.map((person) => [person.id, person.label] as const),
      ...customFieldRefs.entities.map(
        (entity) =>
          [
            entity.id,
            entity.restricted
              ? intl.formatMessage({
                  id: "entities.restricted",
                  defaultMessage: "Restricted Entity",
                })
              : entity.legalName,
          ] as const,
      ),
    ]),
  });

  const open = (() => {
    if (!reading) return null;
    const document = [...paper, ...filed].find((row) => row.id === reading.documentId);
    const version = document?.versions.find((row) => row.id === reading.versionId);
    return document && version ? { document, version } : null;
  })();

  // A document that left the list takes its panel with it. Dropped
  // during render, the way React adjusts state when a prop changes, so
  // a later restore does not reopen a panel nobody asked for.
  if (reading && !open) {
    setReading(null);
    setReadingCovers(false);
  }

  const reference = matterReference(intl, saved.number);
  /** The viewer facts every section card reads (TECH-024 rule 7). One
   * object per change, so a card keyed on it does not re-run every
   * render. The saved row rather than the loader's copy: taking the
   * Owner off takes their controls with them on the same page. */
  const facts = useMemo<RecordFacts>(
    () => ({
      record: { kind: "matter", id: saved.id, number: saved.number },
      viewer: { id: user.id, role: user.role },
      ownerId: saved.manager?.id ?? null,
      confidential: saved.isConfidential,
      canEdit,
      frozen,
    }),
    [
      saved.id,
      saved.number,
      saved.manager?.id,
      saved.isConfidential,
      user.id,
      user.role,
      canEdit,
      frozen,
    ],
  );

  return (
    <RecordContext.Provider value={facts}>
      <AppShell
        user={user}
        onSignOut={() => void signOut()}
        recordScope={{ entityType: "matter", entityId: loader.matter.id }}
        flush
        banner={
          saved.isConfidential ? (
            <ConfidentialBanner
              record="matter"
              manageTeamHref={canManageAudience ? "#matter-team" : undefined}
            />
          ) : undefined
        }
        subbar={
          <>
            <section
              aria-labelledby="page-title"
              // No bottom border of its own: the DES-032 strip beneath
              // carries the sub-bar border, so the two read as one slab.
              className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-canvas px-page-x py-2 @5xl/shell:h-(--height-subbar) @5xl/shell:flex-nowrap @5xl/shell:py-0"
            >
              <div className="flex w-full min-w-0 items-center gap-2 @5xl/shell:w-auto @5xl/shell:flex-1">
                <Link
                  to="/matters"
                  className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                >
                  <FormattedMessage id="matters.title" defaultMessage="Matters" />
                </Link>
                <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
                {relations.parent &&
                  (relations.parent.restricted ? (
                    <>
                      <span className="shrink-0 text-base text-muted">
                        <FormattedMessage
                          id="matters.relations.restricted"
                          defaultMessage="Restricted Matter"
                        />
                      </span>
                      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
                    </>
                  ) : (
                    <>
                      <Link
                        to={`/matters/${relations.parent.number}`}
                        className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                      >
                        {matterReference(intl, relations.parent.number)}
                      </Link>
                      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
                    </>
                  ))}
                <Briefcase size={16} aria-hidden="true" className="shrink-0 text-muted" />
                <span className="shrink-0 text-base font-medium text-muted">{reference}</span>
                <h1 id="page-title" className="truncate text-md font-semibold">
                  {saved.title}
                </h1>
                <span
                  className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${matterStatusPill(saved)}`}
                >
                  {saved.statusName}
                </span>
                {archived && (
                  <span className="inline-flex shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                    <FormattedMessage id="matters.archivedPill" defaultMessage="Archived" />
                  </span>
                )}
              </div>
              <MatterStatusProgression
                statuses={statusOptions}
                statusId={saved.statusId}
                busy={fieldStatus.statusId === "saving" || matterLifecycleStatus === "saving"}
                {...(!frozen
                  ? {
                      onPick: (statusId: string) => {
                        const target = statusOptions.find((status) => status.id === statusId);
                        if (!target || statusId === saved.statusId) return;
                        if (target.category === saved.statusCategory)
                          void commit("statusId", { statusId });
                        else void openMatterLifecycle(statusId);
                      },
                    }
                  : {})}
              />
              {!frozen && (
                <>
                  <StatusNote
                    status={fieldStatus.statusId === "error" ? "error" : "idle"}
                    detail={fieldError.statusId}
                  />
                  <StatusNote
                    status={matterLifecycleStatus === "error" ? "error" : "idle"}
                    detail={matterLifecycleError}
                  />
                </>
              )}
              <div className="flex shrink-0 items-center gap-2">
                {canEdit && (
                  <StatusNote
                    status={lifecycleStatus === "error" ? "error" : "idle"}
                    detail={lifecycleError}
                  />
                )}
                <RecordActionsMenu
                  recordKind="matter"
                  number={saved.number}
                  archived={archived}
                  busy={lifecycleStatus === "saving"}
                  onRename={frozen ? undefined : startRename}
                  onArchive={
                    canEdit ? () => setLifecycleDialog(archived ? "restore" : "archive") : undefined
                  }
                />
              </div>
            </section>
            <RecordTabs
              label={intl.formatMessage({
                id: "matters.record.sections",
                defaultMessage: "Matter sections",
              })}
              tabs={[
                {
                  to: `/matters/${saved.number}`,
                  end: true,
                  label: (
                    <FormattedMessage id="matters.record.tab.overview" defaultMessage="Overview" />
                  ),
                },
                {
                  to: `/matters/${saved.number}/documents`,
                  label: (
                    <FormattedMessage
                      id="matters.record.tab.documents"
                      defaultMessage="Documents"
                    />
                  ),
                },
                {
                  to: `/matters/${saved.number}/key-dates`,
                  label: (
                    <FormattedMessage id="matters.record.tab.keyDates" defaultMessage="Key dates" />
                  ),
                  count: deadlines.filter((row) => !row.overdue).length,
                  countLabel: intl.formatMessage(
                    {
                      id: "matters.record.tab.keyDates.upcoming",
                      defaultMessage:
                        "{count, plural, one {# upcoming date} other {# upcoming dates}}",
                    },
                    { count: deadlines.filter((row) => !row.overdue).length },
                  ),
                },
                {
                  to: `/matters/${saved.number}/tasks`,
                  label: <FormattedMessage id="matters.record.tab.tasks" defaultMessage="Tasks" />,
                  count: checklist.totalCount - checklist.doneCount,
                  countLabel: intl.formatMessage(
                    {
                      id: "matters.record.tab.tasks.open",
                      defaultMessage: "{count, plural, one {# open Task} other {# open Tasks}}",
                    },
                    { count: checklist.totalCount - checklist.doneCount },
                  ),
                },
              ]}
            />
          </>
        }
      >
        <PageTitle
          title={intl.formatMessage(
            { id: "matters.record.pageTitle", defaultMessage: "{reference} · {title}" },
            { reference, title: saved.title },
          )}
        />
        <RecordApplets
          recordKey={saved.id}
          applets={
            user.role === "administrator"
              ? [teamApplet, chatApplet, historyApplet, SETTINGS_APPLET]
              : [teamApplet, chatApplet, historyApplet]
          }
          layer={
            open && (
              <DocPanel
                documentId={open.document.id}
                title={open.document.title}
                version={open.version}
                previousVersion={previousComparableVersion(open.document, open.version)}
                initialFind={
                  loader.documentLanding?.document.id === open.document.id &&
                  loader.documentLanding.versionId === open.version.id
                    ? loader.documentFindQuery
                    : null
                }
                onClose={closeReading}
                onDockedChange={(docked) => {
                  readingDocked.current = docked;
                  setReadingCovers(!docked);
                }}
              />
            )
          }
          contentCovered={open !== null && readingCovers}
        >
          <div
            className={
              tab === "overview"
                ? "flex flex-col gap-4 overflow-y-auto px-page-x py-page-y"
                : "hidden"
            }
          >
            <div className="flex min-w-0 flex-col gap-4">
              <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
                <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
                  <h2 className="text-base font-semibold">
                    <FormattedMessage id="matters.record.section" defaultMessage="Matter" />
                  </h2>
                </header>
                <div className="flex flex-col gap-4 p-4">
                  <MatterConversionValue
                    active={Boolean(saved.aiUnverified?.title)}
                    number={saved.number}
                    slug="title"
                    onConfirmed={!frozen ? confirmedConversion : undefined}
                  >
                    {" "}
                    {frozen ? (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-secondary">
                          <FormattedMessage id="matters.field.title" defaultMessage="Title" />
                        </span>
                        <p className="flex h-8 items-center text-md">{saved.title}</p>
                      </div>
                    ) : (
                      <InlineText
                        id="matter-title"
                        label={intl.formatMessage({
                          id: "matters.field.title",
                          defaultMessage: "Title",
                        })}
                        value={title}
                        status={fieldStatus.title ?? "idle"}
                        error={fieldError.title}
                        onValue={setTitle}
                        onCommit={() => commitText("title")}
                        onCancel={() => setTitle(saved.title)}
                      />
                    )}
                  </MatterConversionValue>{" "}
                  <dl className="grid grid-cols-1 gap-4 @2xl/page:grid-cols-2">
                    <MatterConversionValue
                      active={Boolean(saved.aiUnverified?.matter_type)}
                      number={saved.number}
                      slug="matter_type"
                      onConfirmed={!frozen ? confirmedConversion : undefined}
                    >
                      {" "}
                      <EditableSelectFact
                        id="matter-type"
                        label={
                          <FormattedMessage id="matters.field.type" defaultMessage="Matter type" />
                        }
                        frozen={frozen}
                        value={saved.matterTypeId}
                        display={saved.matterTypeName}
                        status={fieldStatus.matterTypeId ?? "idle"}
                        error={fieldError.matterTypeId}
                        onChange={pickType}
                        options={typeOptions.map((type) => ({
                          value: type.id,
                          label: type.displayName,
                        }))}
                      />
                    </MatterConversionValue>{" "}
                    <EditableSelectFact
                      id="matter-manager"
                      label={
                        <FormattedMessage
                          id="matters.field.manager"
                          defaultMessage="Matter Manager"
                        />
                      }
                      frozen={frozen}
                      value={saved.manager?.id ?? ""}
                      display={
                        saved.manager?.displayName ??
                        intl.formatMessage({
                          id: "matters.unassigned",
                          defaultMessage: "Unassigned",
                        })
                      }
                      status={fieldStatus.managerId ?? "idle"}
                      error={fieldError.managerId}
                      onChange={(managerId) =>
                        void commit("managerId", { managerId: managerId || null })
                      }
                      options={[
                        {
                          value: "",
                          label: intl.formatMessage({
                            id: "matters.unassigned",
                            defaultMessage: "Unassigned",
                          }),
                        },
                        ...[...heldManager, ...managerOptions].map((person) => ({
                          value: person.id,
                          label: person.displayName,
                        })),
                      ]}
                    />
                    <MatterConversionValue
                      active={Boolean(saved.aiUnverified?.priority)}
                      number={saved.number}
                      slug="priority"
                      onConfirmed={!frozen ? confirmedConversion : undefined}
                    >
                      {" "}
                      <EditableSelectFact
                        id="matter-priority"
                        label={
                          <FormattedMessage id="matters.field.priority" defaultMessage="Priority" />
                        }
                        frozen={frozen}
                        value={saved.priority}
                        display={matterSeverityLabel(intl, saved.priority)}
                        status={fieldStatus.priority ?? "idle"}
                        error={fieldError.priority}
                        onChange={(priority) => void commit("priority", { priority })}
                        options={MATTER_SEVERITIES.map((severity) => ({
                          value: severity,
                          label: matterSeverityLabel(intl, severity),
                        }))}
                      />
                    </MatterConversionValue>{" "}
                    <EditableSelectFact
                      id="matter-risk"
                      label={<FormattedMessage id="matters.field.risk" defaultMessage="Risk" />}
                      frozen={frozen}
                      value={saved.risk ?? ""}
                      display={
                        saved.risk
                          ? matterSeverityLabel(intl, saved.risk)
                          : intl.formatMessage({
                              id: "matters.notAssessed",
                              defaultMessage: "Not assessed",
                            })
                      }
                      status={fieldStatus.risk ?? "idle"}
                      error={fieldError.risk}
                      onChange={(risk) => void commit("risk", { risk: risk || null })}
                      options={[
                        {
                          value: "",
                          label: intl.formatMessage({
                            id: "matters.notAssessed",
                            defaultMessage: "Not assessed",
                          }),
                        },
                        ...MATTER_SEVERITIES.map((severity) => ({
                          value: severity,
                          label: matterSeverityLabel(intl, severity),
                        })),
                      ]}
                    />
                  </dl>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-4 @2xl/page:grid-cols-[max-content_max-content]">
                    <Fact
                      label={<FormattedMessage id="matters.field.opened" defaultMessage="Opened" />}
                      value={formatFullDate(saved.openedAt)}
                    />
                    <Fact
                      label={<FormattedMessage id="matters.field.closed" defaultMessage="Closed" />}
                      value={
                        saved.closedAt
                          ? formatFullDate(saved.closedAt)
                          : saved.statusCategory === "open"
                            ? intl.formatMessage({
                                id: "matters.stillOpen",
                                defaultMessage: "Still open",
                              })
                            : notProvided(intl)
                      }
                    />
                  </dl>
                  <section className="pt-1">
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        <FormattedMessage
                          id="matters.field.confidential"
                          defaultMessage="Confidentiality"
                        />
                      </h3>
                      <StatusNote
                        status={fieldStatus.isConfidential ?? "idle"}
                        detail={fieldError.isConfidential}
                      />
                    </div>
                    <ConfidentialToggle
                      id="matter-confidential"
                      record="matter"
                      confidential={saved.isConfidential}
                      disabled={frozen || !canManageAudience}
                      onChange={(isConfidential) =>
                        void commit("isConfidential", { isConfidential })
                      }
                    />
                  </section>
                </div>
              </section>
              <MatterConversionValue
                active={Boolean(saved.aiUnverified?.description)}
                number={saved.number}
                slug="description"
                onConfirmed={!frozen ? confirmedConversion : undefined}
              >
                {" "}
                <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
                  <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
                    <h2 className="text-base font-semibold">
                      <FormattedMessage
                        id="matters.field.description"
                        defaultMessage="Description"
                      />
                    </h2>
                  </header>
                  <div className="p-4">
                    {businessFrozen ? (
                      <p className="whitespace-pre-wrap text-base text-muted">
                        {saved.description || notProvided(intl)}
                      </p>
                    ) : (
                      <>
                        <AutoResizeTextarea
                          aria-label={intl.formatMessage({
                            id: "matters.field.description",
                            defaultMessage: "Description",
                          })}
                          className={TEXTAREA_CLASS}
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          onBlur={() => commitText("description")}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setDescription(saved.description ?? "");
                          }}
                        />
                        <StatusNote
                          status={fieldStatus.description ?? "idle"}
                          detail={fieldError.description}
                        />
                      </>
                    )}
                  </div>
                </section>
              </MatterConversionValue>{" "}
              {fields.length > 0 && (
                <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
                  <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
                    <h2 className="text-base font-semibold">
                      <FormattedMessage id="matters.customFields" defaultMessage="Custom fields" />
                    </h2>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-2">
                    {fields.map((field) => (
                      <MatterConversionValue
                        key={field.slug}
                        active={Boolean(saved.aiUnverified?.[`field:${field.slug}`])}
                        number={saved.number}
                        slug={`field:${field.slug}`}
                        onConfirmed={!frozen ? confirmedConversion : undefined}
                      >
                        {" "}
                        <MatterCustomField
                          // Keyed by slug, so a re-type onto a type that attaches
                          // the same field keeps that control's draft.
                          key={field.slug}
                          field={field}
                          saved={saved.customFields[field.slug]}
                          frozen={
                            frozen && !(contributor && !archived && field.fieldTag === "business")
                          }
                          people={peopleRefs}
                          entities={entityChoices(saved.customFields[field.slug])}
                          status={fieldStatus[`field:${field.slug}`] ?? "idle"}
                          error={fieldError[`field:${field.slug}`]}
                          onInvalid={(detail) => note(`field:${field.slug}`, "error", detail)}
                          onCommit={(value) =>
                            commit(`field:${field.slug}`, {
                              customFields: { [field.slug]: value },
                            })
                          }
                        />
                      </MatterConversionValue>
                    ))}
                  </div>
                </section>
              )}
              <RelatedMattersCard
                relations={relations}
                onChanged={setRelations}
                onCreateChild={() => setSubMatterOpen(true)}
              />
              <LinkedContractsCard
                contracts={linkedContracts}
                onContracts={setLinkedContracts}
                matterTitle={saved.title}
              />
            </div>
          </div>
          {tab === "documents" && (
            <div className="overflow-y-auto px-page-x py-page-y">
              <DocumentsCard
                documents={paper}
                folders={folders}
                nextCursor={paperCursor}
                supportingUploads={contributor && !archived}
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
            </div>
          )}
          {tab === "key-dates" && (
            <div className="overflow-y-auto px-page-x py-page-y">
              <MatterConversionValue
                active={Boolean(saved.aiUnverified?.needed_by)}
                number={saved.number}
                slug="needed_by"
                onConfirmed={!frozen ? confirmedConversion : undefined}
              >
                <MatterKeyDatesCard
                  deadlines={deadlines}
                  onDeadlines={(rows) => {
                    setDeadlines(rows);
                    if (!rows.some((row) => row.unverified)) confirmedConversion("needed_by");
                  }}
                />
              </MatterConversionValue>
            </div>
          )}
          {tab === "tasks" && (
            <div className="overflow-y-auto px-page-x py-page-y">
              <MatterTasksCard
                tasks={checklist.tasks}
                doneCount={checklist.doneCount}
                totalCount={checklist.totalCount}
                assignees={taskAssignees}
                teamExpansion={
                  !frozen && !audienceLocked
                    ? {
                        people: users.filter(
                          (person) => !person.archived && person.role !== "business_user",
                        ),
                        onAdded: (id) => {
                          const person = users.find((candidate) => candidate.id === id);
                          if (person)
                            setTeam((current) =>
                              current.some((member) => member.id === id)
                                ? current
                                : [
                                    ...current,
                                    {
                                      ...person,
                                      role:
                                        person.role === "contributor" ? "contributor" : "member",
                                    },
                                  ],
                            );
                        },
                      }
                    : undefined
                }
                onTasksChange={setChecklist}
              />
            </div>
          )}
        </RecordApplets>
        {retypeTo && (
          <MatterRetypeDialog
            target={retypeTo}
            values={saved.customFields}
            people={peopleRefs}
            // The dialog asks only for the target type's unanswered
            // required Fields. No Field in it holds a saved reference,
            // so the registry is the whole list.
            entities={liveEntities}
            onOpenChange={(open) => {
              if (!open) setRetypeTo(null);
            }}
            onConfirm={async (customFields) => {
              const refusal = await commit("matterTypeId", {
                matterTypeId: retypeTo.id,
                customFields,
              });
              if (!refusal) setRetypeTo(null);
              return refusal;
            }}
          />
        )}
        {lifecycleDialog && (
          <LifecycleDialog
            action={lifecycleDialog}
            title={saved.title}
            saving={lifecycleStatus === "saving"}
            error={lifecycleError}
            onOpenChange={(open) => {
              if (!open) setLifecycleDialog(null);
            }}
            onConfirm={() => void archiveOrRestore()}
          />
        )}
        {matterLifecycle && (
          <MatterLifecycleDialog
            lifecycle={matterLifecycle}
            matterTitle={saved.title}
            statusId={matterLifecycleStatusId}
            saving={matterLifecycleStatus === "saving"}
            error={matterLifecycleError}
            closingNote={matterClosingNote}
            onClosingNote={setMatterClosingNote}
            onOpenChange={(open) => {
              if (!open && matterLifecycleStatus !== "saving") setMatterLifecycle(null);
            }}
            onConfirm={() => void commitMatterLifecycle()}
          />
        )}
        {subMatterOpen && (
          <CreateMatterDialog
            matterTypes={matterTypes}
            users={users}
            entities={liveEntities}
            viewerId={user.id}
            parent={{ number: saved.number, title: saved.title }}
            onOpenChange={setSubMatterOpen}
            onCreated={(matter) => void navigate(`/matters/${matter.number}`)}
          />
        )}
      </AppShell>
    </RecordContext.Provider>
  );
}

function InlineText({
  id,
  label,
  value,
  status,
  error,
  onValue,
  onCommit,
  onCancel,
}: {
  id: string;
  label: string;
  value: string;
  status: FieldStatus;
  error?: string;
  onValue: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") onCancel();
        }}
      />
      <StatusNote status={status} detail={error} />
    </div>
  );
}

function EditableSelectFact({
  id,
  label,
  frozen,
  value,
  display,
  status,
  error,
  options,
  onChange,
}: {
  id: string;
  label: ReactNode;
  frozen: boolean;
  value: string;
  display: string;
  status: FieldStatus;
  error?: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <dt>
        <Label htmlFor={id}>{label}</Label>
      </dt>
      <dd className="mt-1.5 text-md">
        {frozen ? (
          display
        ) : (
          <select
            id={id}
            className={CONTROL_CLASS}
            value={value}
            disabled={status === "saving"}
            onChange={(event) => onChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value || "empty"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        {!frozen && <StatusNote status={status} detail={error} />}
      </dd>
    </div>
  );
}

function MatterCustomField({
  field,
  saved,
  frozen,
  people,
  entities,
  status,
  error,
  onInvalid,
  onCommit,
}: {
  field: MatterField;
  saved: CustomFieldValue | undefined;
  frozen: boolean;
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  status: FieldStatus;
  error?: string;
  onInvalid: (detail: string) => void;
  onCommit: (value: CustomFieldValue | null) => Promise<string | undefined>;
}) {
  const intl = useIntl();
  const [draft, setDraft] = useState<CustomFieldDraft>(() => toDraft(field, saved));
  // The value the draft was last seeded from, compared by content. A
  // re-type that filled this field answers with a new saved value, and
  // the control must show it rather than the empty draft it held.
  const [seed, setSeed] = useState(() => JSON.stringify(saved ?? null));
  const seeded = JSON.stringify(saved ?? null);
  if (seed !== seeded) {
    setSeed(seeded);
    setDraft(toDraft(field, saved));
  }
  const id = `matter-field-${field.slug}`;
  function commitDraft(next = draft) {
    // Enter already committed this draft and the PATCH is in flight;
    // the blur that follows must not send a duplicate.
    if (status === "saving") return;
    if (sameDraft(next, toDraft(field, saved))) return;
    const converted = toValue(field, next);
    if ("error" in converted) {
      onInvalid(
        intl.formatMessage(
          {
            id: "matters.retype.invalidField",
            defaultMessage: "{field} must be a number.",
          },
          { field: field.displayName },
        ),
      );
      return;
    }
    void onCommit(converted.value);
  }
  return (
    <div
      className={`flex flex-col gap-1.5 ${field.fieldType === "text" || field.fieldType === "long_text" ? "@2xl/page:col-span-2" : ""}`}
    >
      <Label id={`${id}-label`} htmlFor={id}>
        {field.displayName}
        {!frozen && field.isRequired && (
          <>
            <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
              *
            </span>
            <span className="sr-only">
              <FormattedMessage id="matters.field.requiredMark" defaultMessage="(required)" />
            </span>
          </>
        )}
      </Label>
      {frozen ? (
        <span>
          {!isAnswered(saved)
            ? intl.formatMessage({ id: "matters.record.notRecorded", defaultMessage: "—" })
            : field.fieldType === "user"
              ? (people.find((person) => person.id === saved)?.label ?? String(saved))
              : field.fieldType === "entity"
                ? (entities.find((entity) => entity.id === saved)?.label ?? String(saved))
                : Array.isArray(saved)
                  ? saved.join(", ")
                  : typeof saved === "number"
                    ? intl.formatNumber(saved, { maximumFractionDigits: 20 })
                    : String(saved)}
        </span>
      ) : (
        <CustomFieldControl
          id={id}
          field={field}
          draft={draft}
          people={people}
          entities={entities}
          required={field.isRequired}
          invalid={status === "error"}
          onDraft={(next) => {
            setDraft(next);
            if (commitsOnChange(field)) commitDraft(next);
          }}
          onBlur={() => commitDraft()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitDraft();
            if (event.key === "Escape") setDraft(toDraft(field, saved));
          }}
        />
      )}
      {!frozen && <StatusNote status={status} detail={error} />}
    </div>
  );
}

function MatterRetypeDialog({
  target,
  values,
  people,
  entities,
  onOpenChange,
  onConfirm,
}: {
  target: MatterTypeOption;
  values: MatterRow["customFields"];
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: Record<string, CustomFieldValue | null>) => Promise<string | undefined>;
}) {
  const intl = useIntl();
  const gaps = unansweredRequired(target.fields, values);
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>(() =>
    Object.fromEntries(gaps.map((field) => [field.slug, toDraft(field, values[field.slug])])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const customFields: Record<string, CustomFieldValue | null> = {};
    for (const field of gaps) {
      const converted = toValue(field, drafts[field.slug] ?? toDraft(field, undefined));
      if ("error" in converted) {
        setError(
          intl.formatMessage(
            {
              id: "matters.retype.invalidField",
              defaultMessage: "{field} must be a number.",
            },
            { field: field.displayName },
          ),
        );
        return;
      }
      customFields[field.slug] = converted.value;
    }
    setSaving(true);
    const refusal = await onConfirm(customFields);
    setSaving(false);
    if (refusal) setError(refusal);
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="matter-retype-description">
        <DialogTitle>
          <FormattedMessage
            id="matters.retype.title"
            defaultMessage="Change matter type to {type}"
            values={{ type: target.displayName }}
          />
        </DialogTitle>
        <p id="matter-retype-description" className="mt-2 text-sm text-muted">
          <FormattedMessage
            id="matters.retype.description"
            defaultMessage="Complete the new type's required fields before changing it."
          />
        </p>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {gaps.map((field) => {
            const id = `retype-${field.slug}`;
            return (
              <div key={field.fieldId} className="flex flex-col gap-1.5">
                <Label id={`${id}-label`} htmlFor={id}>
                  {field.displayName}
                  <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                    *
                  </span>
                  <span className="sr-only">
                    <FormattedMessage id="matters.field.requiredMark" defaultMessage="(required)" />
                  </span>
                </Label>
                <CustomFieldControl
                  id={id}
                  field={field}
                  draft={drafts[field.slug] ?? toDraft(field, undefined)}
                  people={people}
                  entities={entities}
                  required
                  onDraft={(draft) => setDrafts((current) => ({ ...current, [field.slug]: draft }))}
                />
              </div>
            );
          })}
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={saving}>
              <FormattedMessage id="matters.retype.confirm" defaultMessage="Change type" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LifecycleDialog({
  action,
  title,
  saving,
  error,
  onOpenChange,
  onConfirm,
}: {
  action: "archive" | "restore";
  title: string;
  saving: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="matter-lifecycle-description">
        <DialogTitle>
          {action === "archive" ? (
            <FormattedMessage
              id="matters.archive.title"
              defaultMessage="Archive {title}?"
              values={{ title }}
            />
          ) : (
            <FormattedMessage
              id="matters.restore.title"
              defaultMessage="Restore {title}?"
              values={{ title }}
            />
          )}
        </DialogTitle>
        <p id="matter-lifecycle-description" className="mt-2 text-sm text-muted">
          {action === "archive" ? (
            <FormattedMessage
              id="matters.archive.description"
              defaultMessage="The matter leaves the default list. Its history and M-number are kept."
            />
          ) : (
            <FormattedMessage
              id="matters.restore.description"
              defaultMessage="The matter returns to the default list and becomes editable again."
            />
          )}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button disabled={saving} onClick={onConfirm}>
            {action === "archive" ? (
              <FormattedMessage id="matters.record.archive" defaultMessage="Archive" />
            ) : (
              <FormattedMessage id="matters.record.restore" defaultMessage="Restore" />
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MatterLifecycleDialog({
  lifecycle,
  matterTitle,
  statusId,
  saving,
  error,
  closingNote,
  onClosingNote,
  onOpenChange,
  onConfirm,
}: {
  lifecycle: MatterLifecycle;
  matterTitle: string;
  statusId: string;
  saving: boolean;
  error: string | null;
  closingNote: string;
  onClosingNote: (note: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const intl = useIntl();
  const closing = lifecycle.action === "close";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={closing ? undefined : "matter-status-lifecycle-description"}>
        <DialogTitle>
          {closing ? (
            <FormattedMessage
              id="matters.close.title"
              defaultMessage="Close {title}?"
              values={{ title: matterTitle }}
            />
          ) : (
            <FormattedMessage
              id="matters.reopen.title"
              defaultMessage="Reopen {title}?"
              values={{ title: matterTitle }}
            />
          )}
        </DialogTitle>
        {!closing && (
          <p id="matter-status-lifecycle-description" className="mt-2 text-sm text-muted">
            <FormattedMessage
              id="matters.reopen.description"
              defaultMessage="The Matter returns to active surfaces. Its original opened date is preserved."
            />
          </p>
        )}
        {closing && (
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="matter-closing-note" required>
              <FormattedMessage id="matters.close.note" defaultMessage="Closing note" />
            </Label>
            <textarea
              id="matter-closing-note"
              className={TEXTAREA_CLASS}
              autoFocus
              required
              aria-required="true"
              maxLength={2000}
              rows={3}
              value={closingNote}
              disabled={saving}
              onChange={(event) => onClosingNote(event.target.value)}
            />
          </div>
        )}
        {closing && lifecycle.openChildren.length > 0 && (
          <section
            aria-labelledby="matter-open-children-title"
            className="mt-4 rounded-card border border-border-default bg-subtle p-3"
          >
            <h3 id="matter-open-children-title" className="text-sm font-semibold">
              <FormattedMessage
                id="matters.close.openChildren"
                defaultMessage="Open child Matters"
              />
            </h3>
            <p className="mt-1 text-sm text-muted">
              <FormattedMessage
                id="matters.close.openChildrenDescription"
                defaultMessage="These child Matters will stay open. Closing this parent changes none of them."
              />
            </p>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
              {lifecycle.openChildren.map((child, index) => (
                <li key={child.restricted ? `restricted-${index}` : child.number}>
                  {child.restricted ? (
                    <FormattedMessage
                      id="matters.relations.restricted"
                      defaultMessage="Restricted Matter"
                    />
                  ) : (
                    <Link to={`/matters/${child.number}`} className="text-link hover:underline">
                      {matterReference(intl, child.number)} {child.title}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            disabled={saving || !statusId || (closing && !closingNote.trim())}
            onClick={onConfirm}
          >
            {closing ? (
              <FormattedMessage id="matters.record.close" defaultMessage="Close matter" />
            ) : (
              <FormattedMessage id="matters.record.reopen" defaultMessage="Reopen matter" />
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-secondary">{label}</dt>
      <dd className="mt-1.5 flex h-8 items-center text-md">{value}</dd>
    </div>
  );
}
