// SPDX-License-Identifier: AGPL-3.0-only

/** M22/5's editable matter record: one commit per field and recoverable lifecycle acts. */
import { useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, ChevronRight } from "lucide-react";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  commitsOnChange,
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
  matterReference,
  matterSeverityLabel,
  type MatterField,
  type MatterRow,
  type MatterStatusOption,
  type MatterTeamMember,
  type MatterTypeOption,
} from "../lib/matters";
import { problemDetail } from "../lib/messages";
import { canReadMatters, isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { ConfidentialBanner } from "../components/confidential-banner";
import { ConfidentialToggle } from "../components/confidential-toggle";
import { useActivityApplet } from "../components/activity/activity-applet";
import { useCommentApplet } from "../components/comments/comment-applet";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import { MatterTeamTray } from "../components/matters/team-tray";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { RecordApplets } from "../components/shell/record-applets";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function matterRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (!canReadMatters(user.role)) return redirect("/");
  const number = Number(params.matterNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error("That is not a matter reference.");
  const canEdit = isMemberPlus(user.role);
  const [record, options] = await Promise.all([
    api.GET("/api/v1/matters/{number}", { params: { path: { number } } }),
    canEdit ? api.GET("/api/v1/matters/options") : undefined,
  ]);
  if (!record.data) throw new Error("The matter could not be read.");
  if (canEdit && !options?.data) throw new Error("The matter's edit options could not be read.");
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

export function MatterRecordPage() {
  const loader = useLoaderData<typeof matterRecordLoader>();
  const { user, matterTypes, matterStatuses, users } = loader;
  const intl = useIntl();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(loader.matter);
  const [fields, setFields] = useState(loader.fields);
  const [customFieldRefs, setCustomFieldRefs] = useState(loader.customFieldRefs);
  const [team, setTeam] = useState<MatterTeamMember[]>(loader.team);
  const [title, setTitle] = useState(saved.title);
  const [description, setDescription] = useState(saved.description ?? "");
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<FieldKey, FieldStatus>>>({});
  const [fieldError, setFieldError] = useState<Partial<Record<FieldKey, string | undefined>>>({});
  const [retypeTo, setRetypeTo] = useState<MatterTypeOption | null>(null);
  const [lifecycleDialog, setLifecycleDialog] = useState<"archive" | "restore" | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState<FieldStatus>("idle");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const canEdit = isMemberPlus(user.role);
  const archived = saved.archivedAt !== null;
  const frozen = !canEdit || archived;
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

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  function note(key: FieldKey, status: FieldStatus, detail?: string) {
    setFieldStatus((current) => ({ ...current, [key]: status }));
    setFieldError((current) => ({ ...current, [key]: detail }));
  }

  async function commit(key: FieldKey, body: Record<string, unknown>) {
    note(key, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/matters/{number}", {
        params: { path: { number: saved.number } },
        body,
      })
      .catch(() => ({ data: undefined, error: undefined }));
    if (!data) {
      const detail = problemDetail(error);
      note(key, "error", detail);
      return (
        detail ??
        intl.formatMessage({
          id: "matters.edit.error",
          defaultMessage: "The change could not be saved.",
        })
      );
    }
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
            .catch(() => ({ data: undefined, error: undefined }))
        : await api
            .POST("/api/v1/matters/{number}/restore", {
              params: { path: { number: saved.number } },
            })
            .catch(() => ({ data: undefined, error: undefined }));
    if (!result.data) {
      setLifecycleStatus("error");
      setLifecycleError(problemDetail(result.error) ?? null);
      return;
    }
    setSaved(result.data.matter);
    setLifecycleStatus("saved");
    setLifecycleDialog(null);
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
  const chatApplet = useCommentApplet({
    entityType: "matter",
    entityId: saved.id,
    role: user.role,
    viewerId: user.id,
    confidential: saved.isConfidential,
  });
  const historyApplet = useActivityApplet({
    entityType: "matter",
    entityId: saved.id,
    confidential: saved.isConfidential,
    fields,
    referenceNames: Object.fromEntries([
      ...peopleRefs.map((person) => [person.id, person.label] as const),
      ...customFieldRefs.entities.map((entity) => [entity.id, entity.legalName] as const),
    ]),
  });

  const reference = matterReference(intl, saved.number);
  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
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
        <section
          aria-labelledby="page-title"
          className="flex min-h-(--height-subbar) shrink-0 items-center gap-2 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
        >
          <Link to="/matters" className="text-link hover:underline">
            <FormattedMessage id="matters.title" defaultMessage="Matters" />
          </Link>
          <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
          <span className="text-sm text-muted">{reference}</span>
          <h1 id="page-title" className="min-w-0 flex-1 truncate text-xl font-semibold">
            {saved.title}
          </h1>
          {frozen ? (
            <span className="rounded-pill bg-status-info-bg px-2 py-0.5 text-xs font-medium text-status-info-fg">
              {saved.statusName}
            </span>
          ) : (
            <select
              id="matter-status"
              aria-label={intl.formatMessage({
                id: "matters.field.status",
                defaultMessage: "Status",
              })}
              className={CONTROL_CLASS}
              value={saved.statusId}
              disabled={fieldStatus.statusId === "saving"}
              onChange={(event) => void commit("statusId", { statusId: event.target.value })}
            >
              <StatusGroup
                label={intl.formatMessage({
                  id: "matters.status.open",
                  defaultMessage: "Open",
                })}
                category="open"
                statuses={statusOptions}
              />
              <StatusGroup
                label={intl.formatMessage({
                  id: "matters.status.closed",
                  defaultMessage: "Closed",
                })}
                category="closed"
                statuses={statusOptions}
              />
            </select>
          )}
          {!frozen && (
            <StatusNote status={fieldStatus.statusId ?? "idle"} detail={fieldError.statusId} />
          )}
          {archived && (
            <span className="rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
              <FormattedMessage id="matters.archivedPill" defaultMessage="Archived" />
            </span>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLifecycleDialog(archived ? "restore" : "archive")}
            >
              {archived ? (
                <ArchiveRestore size={16} aria-hidden="true" />
              ) : (
                <Archive size={16} aria-hidden="true" />
              )}
              {archived ? (
                <FormattedMessage id="matters.record.restore" defaultMessage="Restore" />
              ) : (
                <FormattedMessage id="matters.record.archive" defaultMessage="Archive" />
              )}
            </Button>
          )}
        </section>
      }
    >
      <PageTitle
        title={intl.formatMessage(
          { id: "matters.record.pageTitle", defaultMessage: "{reference} · {title}" },
          { reference, title: saved.title },
        )}
      />
      <RecordApplets applets={[chatApplet, historyApplet]}>
        <div className="grid max-w-6xl gap-5 overflow-y-auto px-page-x py-page-y lg:grid-cols-[minmax(0,1fr)_18rem]">
          <article className="rounded-card border border-border-default bg-raised p-5">
            <header className="mb-5">
              <p className="text-sm font-medium text-muted">{reference}</p>
              {frozen ? (
                <h2 className="mt-1 text-2xl font-semibold">{saved.title}</h2>
              ) : (
                <InlineText
                  id="matter-title"
                  label={intl.formatMessage({ id: "matters.field.title", defaultMessage: "Title" })}
                  value={title}
                  status={fieldStatus.title ?? "idle"}
                  error={fieldError.title}
                  onValue={setTitle}
                  onCommit={() => commitText("title")}
                  title
                />
              )}
            </header>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <EditableSelectFact
                id="matter-type"
                label={<FormattedMessage id="matters.field.type" defaultMessage="Matter type" />}
                frozen={frozen}
                value={saved.matterTypeId}
                display={saved.matterTypeName}
                status={fieldStatus.matterTypeId ?? "idle"}
                error={fieldError.matterTypeId}
                onChange={pickType}
                options={typeOptions.map((type) => ({ value: type.id, label: type.displayName }))}
              />
              <EditableSelectFact
                id="matter-manager"
                label={
                  <FormattedMessage id="matters.field.manager" defaultMessage="Matter Manager" />
                }
                frozen={frozen}
                value={saved.manager?.id ?? ""}
                display={
                  saved.manager?.displayName ??
                  intl.formatMessage({ id: "matters.unassigned", defaultMessage: "Unassigned" })
                }
                status={fieldStatus.managerId ?? "idle"}
                error={fieldError.managerId}
                onChange={(managerId) => void commit("managerId", { managerId: managerId || null })}
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
              <EditableSelectFact
                id="matter-priority"
                label={<FormattedMessage id="matters.field.priority" defaultMessage="Priority" />}
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
              <Fact
                label={<FormattedMessage id="matters.field.opened" defaultMessage="Opened" />}
                value={formatFullDate(saved.openedAt)}
              />
              <Fact
                label={<FormattedMessage id="matters.field.closed" defaultMessage="Closed" />}
                value={saved.closedAt ? formatFullDate(saved.closedAt) : notProvided(intl)}
              />
            </dl>
            <section className="mt-6 border-t border-border-default pt-5">
              <div className="mb-4 flex items-center gap-2">
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
                onChange={(isConfidential) => void commit("isConfidential", { isConfidential })}
              />
            </section>
            <section className="mt-6 border-t border-border-default pt-5">
              <h3 className="mb-2 text-sm font-semibold">
                <FormattedMessage id="matters.field.description" defaultMessage="Description" />
              </h3>
              {frozen ? (
                <p className="whitespace-pre-wrap text-base text-muted">
                  {saved.description || notProvided(intl)}
                </p>
              ) : (
                <>
                  <textarea
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
            </section>
            {fields.length > 0 && (
              <section className="mt-6 border-t border-border-default pt-5">
                <h3 className="mb-4 text-sm font-semibold">
                  <FormattedMessage id="matters.customFields" defaultMessage="Custom fields" />
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((field) => (
                    <MatterCustomField
                      // Keyed by slug, so a re-type onto a type that attaches
                      // the same field keeps that control's draft.
                      key={field.slug}
                      field={field}
                      saved={saved.customFields[field.slug]}
                      frozen={frozen}
                      people={peopleRefs}
                      entities={customFieldRefs.entities.map((entity) => ({
                        id: entity.id,
                        label: entity.legalName,
                      }))}
                      status={fieldStatus[`field:${field.slug}`] ?? "idle"}
                      error={fieldError[`field:${field.slug}`]}
                      onInvalid={(detail) => note(`field:${field.slug}`, "error", detail)}
                      onCommit={(value) =>
                        commit(`field:${field.slug}`, {
                          customFields: { [field.slug]: value },
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </article>
          <MatterTeamTray
            number={saved.number}
            manager={saved.manager}
            team={team}
            users={users}
            frozen={frozen}
            audienceLocked={audienceLocked}
            onTeam={setTeam}
          />
        </div>
      </RecordApplets>
      {retypeTo && (
        <MatterRetypeDialog
          target={retypeTo}
          values={saved.customFields}
          people={peopleRefs}
          entities={customFieldRefs.entities.map((entity) => ({
            id: entity.id,
            label: entity.legalName,
          }))}
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
    </AppShell>
  );
}

function StatusGroup({
  label,
  category,
  statuses,
}: {
  label: string;
  category: "open" | "closed";
  statuses: readonly MatterStatusOption[];
}) {
  return (
    <optgroup label={label}>
      {statuses
        .filter((status) => status.category === category)
        .map((status) => (
          <option key={status.id} value={status.id}>
            {status.displayName}
          </option>
        ))}
    </optgroup>
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
  title = false,
}: {
  id: string;
  label: string;
  value: string;
  status: FieldStatus;
  error?: string;
  onValue: (value: string) => void;
  onCommit: () => void;
  title?: boolean;
}) {
  return (
    <div>
      <Label className="sr-only" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        aria-label={label}
        className={title ? "mt-1 text-2xl font-semibold" : undefined}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
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
        <Label className="text-xs font-medium text-muted" htmlFor={id}>
          {label}
        </Label>
      </dt>
      <dd className="mt-1">
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
    <div className="flex flex-col gap-1.5">
      <Label id={`${id}-label`} htmlFor={id}>
        {field.displayName}
        {!frozen && field.isRequired ? " *" : ""}
      </Label>
      {frozen ? (
        <span>
          {saved === undefined
            ? "—"
            : field.fieldType === "user"
              ? (people.find((person) => person.id === saved)?.label ?? String(saved))
              : field.fieldType === "entity"
                ? (entities.find((entity) => entity.id === saved)?.label ?? String(saved))
                : Array.isArray(saved)
                  ? saved.join(", ")
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
                  {field.displayName} *
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

function Fact({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-base">{value}</dd>
    </div>
  );
}
