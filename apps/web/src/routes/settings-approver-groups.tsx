// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Approver groups (#231), the CTR-012 reusable sign-off
 * templates: the ListEditor in the plain DES-020 anatomy with two
 * DES-021 extension points. The list is unordered (a group has no
 * display order — the picker lists groups by name), so no grip and no
 * reorder; and creation sets a name, a description, and a member list,
 * so the Add CTA opens the group-editor dialog rather than an inline
 * row. In-place rename on the name cell stays (DES-017), and the row's
 * right-aligned meta caption is the member count.
 *
 * The archive guard is DES-021's third shape — no reassignment and no
 * structural block. Applying a group snapshots its members (CTR-012),
 * so an archived group only leaves the apply picker and every request it
 * already produced is untouched; the guard says exactly that.
 *
 * Only Member+ users can approve a contract (CTR-012, DD-013), so the
 * member picker offers Administrators and Legal Team Members only. A
 * person who was on a group before they lost that standing still renders
 * — dropping them silently would edit the template behind the
 * Administrator's back — and the API's refusal is what says so.
 *
 * The loader is the client half of SET-002's gate; the API's 403 is the
 * real refusal.
 */

import { useMemo, useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { History, Pencil, TriangleAlert } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { MEMBER_PLUS_ROLES } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { ListEditor, type ListEditorRow } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsApproverGroupsLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [groups, people] = await Promise.all([
    api.GET("/api/v1/approver-groups", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/users"),
  ]);
  if (!groups.data) throw new Error("The approver groups could not be read.");
  if (!people.data) throw new Error("The users could not be read.");
  return { approverGroups: groups.data.approverGroups, users: people.data.users };
}

/** One group exactly as the seam answers it, and one of its members.
 * Aliased to the generated client schema rather than restated, so a
 * change to the API response surfaces as a compile error here instead
 * of a runtime surprise in the pane (TECH-015). */
type ApiGroup =
  paths["/api/v1/approver-groups"]["get"]["responses"]["200"]["content"]["application/json"]["approverGroups"][number];
type GroupMember = ApiGroup["members"][number];

/** One row of GET /approver-groups, adapted to the ListEditor's shape:
 * the anatomy names a row by `displayName`, the table's column is
 * `name` (SCHEMA.md), and this is the one place the two meet. */
interface GroupRow extends ListEditorRow {
  description: string | null;
  members: GroupMember[];
  memberCount: number;
}

function toRow(group: ApiGroup): GroupRow {
  return {
    id: group.id,
    displayName: group.name,
    description: group.description,
    archivedAt: group.archivedAt,
    members: group.members,
    memberCount: group.memberCount,
  };
}

/** A new row at its place in the list. The API answers in name order,
 * so a created group belongs where a reload would put it — appending it
 * would leave the pane ordered one way and the next load ordered
 * another. */
function insertByName(rows: readonly GroupRow[], row: GroupRow): GroupRow[] {
  const at = rows.findIndex((existing) => existing.displayName.localeCompare(row.displayName) > 0);
  return at === -1 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
}

/** Somebody the picker can offer, or a member it has to keep showing. */
interface Candidate {
  id: string;
  displayName: string;
  email: string;
  /** False for a member who is no longer Member+ or has been archived:
   * still drawn, still checked, and refused by the API on save. */
  eligible: boolean;
}

/** One person as GET /users answers them, aliased for the same reason. */
type UserRow =
  paths["/api/v1/users"]["get"]["responses"]["200"]["content"]["application/json"]["users"][number];

/** Live Member+ users, in display-name order — who a group may hold. */
function eligiblePeople(users: readonly UserRow[]): Candidate[] {
  return users
    .filter(
      (user) =>
        user.status !== "archived" && (MEMBER_PLUS_ROLES as readonly string[]).includes(user.role),
    )
    .map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      eligible: true,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function GroupEditorDialog({
  target,
  people,
  onOpenChange,
  onRowChanged,
  onCreated,
}: Readonly<{
  /** The group being edited, or null for create mode. */
  target: GroupRow | null;
  people: readonly Candidate[];
  onOpenChange: (open: boolean) => void;
  onRowChanged: (row: GroupRow) => void;
  onCreated: (row: GroupRow) => void;
}>) {
  const intl = useIntl();
  const [name, setName] = useState(target?.displayName ?? "");
  const [description, setDescription] = useState(target?.description ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(
    () => target?.members.map((member) => member.id) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A member who has since lost their standing still shows, checked, so
  // the Administrator sees what saving would change.
  const candidates = useMemo<Candidate[]>(() => {
    const known = new Set(people.map((person) => person.id));
    const extras = (target?.members ?? [])
      .filter((member) => !known.has(member.id))
      .map((member) => ({ ...member, eligible: false }));
    return [...people, ...extras];
  }, [people, target]);

  const checked = new Set(memberIds);

  function toggle(id: string, on: boolean) {
    setMemberIds((current) =>
      on ? [...current, id] : current.filter((candidate) => candidate !== id),
    );
  }

  function refuse(message: string) {
    setError(message);
  }

  async function create() {
    const { data, error: problem } = await api
      .POST("/api/v1/approver-groups", {
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          memberIds,
        },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      refuse(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.approverGroups.createError",
            defaultMessage: "The group could not be created.",
          }),
      );
      return false;
    }
    onCreated(toRow(data.approverGroup));
    return true;
  }

  async function edit(existing: GroupRow) {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const body: { name?: string; description?: string | null } = {};
    if (trimmedName !== existing.displayName) body.name = trimmedName;
    if (trimmedDescription !== (existing.description ?? "")) {
      body.description = trimmedDescription || null;
    }

    let latest = existing;
    if (Object.keys(body).length > 0) {
      const { data, error: problem } = await api
        .PATCH("/api/v1/approver-groups/{id}", {
          params: { path: { id: existing.id } },
          body,
        })
        .catch(() => ({ data: null, error: undefined }));
      if (!data) {
        refuse(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.approverGroups.editError",
              defaultMessage: "The group could not be saved.",
            }),
        );
        return false;
      }
      latest = toRow(data.approverGroup);
      onRowChanged(latest);
    }

    const before = [...latest.members.map((member) => member.id)].sort();
    const after = [...memberIds].sort();
    if (before.join(",") === after.join(",")) return true;

    const { data, error: problem } = await api
      .PUT("/api/v1/approver-groups/{id}/members", {
        params: { path: { id: latest.id } },
        body: { memberIds },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      refuse(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.approverGroups.membersError",
            defaultMessage: "The member list could not be saved.",
          }),
      );
      return false;
    }
    onRowChanged(toRow(data.approverGroup));
    return true;
  }

  async function submit() {
    if (busy) return;
    setError(null);
    if (name.trim() === "") {
      refuse(
        intl.formatMessage({
          id: "settings.approverGroups.nameMissing",
          defaultMessage: "Name the group.",
        }),
      );
      return;
    }
    setBusy(true);
    const done = target === null ? await create() : await edit(target);
    setBusy(false);
    if (done) onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {target === null ? (
            <FormattedMessage
              id="settings.approverGroups.addTitle"
              defaultMessage="Add approver group"
            />
          ) : (
            <FormattedMessage
              id="settings.approverGroups.editTitle"
              defaultMessage="Edit {name}"
              values={{ name: target.displayName }}
            />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">
              <FormattedMessage id="settings.approverGroups.nameLabel" defaultMessage="Name" />
            </Label>
            <Input
              id="group-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-description">
              <FormattedMessage
                id="settings.approverGroups.descriptionLabel"
                defaultMessage="Description"
              />
            </Label>
            <Input
              id="group-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.approverGroups.descriptionHelp"
                defaultMessage="Shown beside the group wherever it is applied."
              />
            </p>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1.5 text-sm font-medium text-primary">
              <FormattedMessage
                id="settings.approverGroups.membersLabel"
                defaultMessage="Members"
              />
            </legend>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="settings.approverGroups.noCandidates"
                  defaultMessage="No Administrator or Legal team member is available yet."
                />
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded-button border border-border-default">
                {candidates.map((person) => (
                  <li
                    key={person.id}
                    className="flex h-11 items-center gap-3 border-b border-border-muted px-3 last:border-b-0"
                  >
                    <Checkbox
                      id={`group-member-${person.id}`}
                      checked={checked.has(person.id)}
                      onCheckedChange={(state) => toggle(person.id, state === true)}
                    />
                    <Label
                      htmlFor={`group-member-${person.id}`}
                      className="flex min-w-0 flex-1 items-baseline gap-2 font-normal"
                    >
                      <span className="truncate text-base text-primary">{person.displayName}</span>
                      <span className="truncate text-sm text-muted">{person.email}</span>
                      {!person.eligible && (
                        <span className="ms-auto inline-flex rounded-pill bg-status-warning-bg px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-status-warning-fg">
                          <FormattedMessage
                            id="settings.approverGroups.ineligible"
                            defaultMessage="Can no longer approve"
                          />
                        </span>
                      )}
                    </Label>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.approverGroups.membersHelp"
                defaultMessage="Only Administrators and Legal team members can approve a contract."
              />
            </p>
          </fieldset>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {target === null ? (
                <FormattedMessage
                  id="settings.approverGroups.createSubmit"
                  defaultMessage="Add group"
                />
              ) : (
                <FormattedMessage id="settings.approverGroups.editSubmit" defaultMessage="Save" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveGroupDialog({
  target,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: GroupRow;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: GroupRow) => void;
  /** Where focus lands after a successful archive — the row's archive
   * button unmounts with the row, so the default restore has no home. */
  onArchivedCloseFocus: () => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = useRef(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/approver-groups/{id}/archive", {
        params: { path: { id: target.id } },
      });
      if (data) {
        archived.current = true;
        onArchived(toRow(data.approverGroup));
        onOpenChange(false);
      } else {
        // The API's own refusal (already archived, a stale list) is more
        // actionable than any generic line.
        setError(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.approverGroups.archiveError",
              defaultMessage: "The group could not be archived.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.approverGroups.archiveError",
          defaultMessage: "The group could not be archived.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!archived.current) return;
          event.preventDefault();
          onArchivedCloseFocus();
        }}
      >
        <DialogTitle>
          <FormattedMessage
            id="settings.approverGroups.archiveTitle"
            defaultMessage="Archive {name}"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {/* Groups never reassign and never block: applying a group
                snapshots its members (CTR-012), so an archived group
                changes nothing that already happened. */}
            <p>
              <FormattedMessage
                id="settings.approverGroups.archiveWarning"
                defaultMessage={
                  "{count, plural, =0 {{name} leaves the apply picker. It has no members, " +
                  "and it can be restored.} one {{name} leaves the apply picker. Its # " +
                  "member is kept, and approvals already requested from the group are " +
                  "untouched.} other {{name} leaves the apply picker. Its # members are " +
                  "kept, and approvals already requested from the group are untouched.}}"
                }
                values={{ name: target.displayName, count: target.memberCount }}
              />
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage
              id="settings.approverGroups.auditNote"
              defaultMessage="The change applies immediately and is recorded in the audit log."
            />
          </p>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void submit()}>
              <FormattedMessage
                id="settings.approverGroups.archiveSubmit"
                defaultMessage="Archive group"
              />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsApproverGroupsPage() {
  const { approverGroups, users } = useLoaderData<typeof settingsApproverGroupsLoader>();
  const intl = useIntl();

  const [rows, setRows] = useState<GroupRow[]>(() => approverGroups.map((group) => toRow(group)));
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  /** The editor dialog: closed, create mode, or an edit target. */
  const [editor, setEditor] = useState<{ target: GroupRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<GroupRow | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const people = useMemo(() => eligiblePeople(users), [users]);

  // The list is unordered (DES-021): the API answers in name order and
  // the pane keeps it.
  const live = rows.filter((row) => !row.archivedAt);
  const archived = rows.filter((row) => row.archivedAt);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: GroupRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: GroupRow, displayName: string) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/approver-groups/{id}", {
        params: { path: { id: row.id } },
        body: { name: displayName },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(toRow(data.approverGroup));
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function restore(row: GroupRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/approver-groups/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(toRow(data.approverGroup));
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.approverGroups.pageTitle",
          defaultMessage: "Approver groups",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        <ContractsSettingsTabs />
        <ListEditor
          rows={live}
          archivedRows={archived}
          title={
            <FormattedMessage id="settings.approverGroups.title" defaultMessage="Approver groups" />
          }
          count={
            <FormattedMessage
              id="settings.approverGroups.count"
              defaultMessage="{count, plural, one {# group} other {# groups}}"
              values={{ count: live.length }}
            />
          }
          addLabel={
            <FormattedMessage id="settings.approverGroups.add" defaultMessage="Add group" />
          }
          onAdd={() => setEditor({ target: null })}
          help={
            <FormattedMessage
              id="settings.approverGroups.help"
              defaultMessage={
                "Only Administrators and Legal team members can be group members. Applying a " +
                "group copies its members onto the contract, so editing or archiving a group " +
                "never changes an approval already requested."
              }
            />
          }
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) =>
            intl.formatMessage(
              { id: "settings.approverGroups.renameLabel", defaultMessage: "Rename {name}" },
              { name: row.displayName },
            )
          }
          onRename={(row, displayName) => void rename(row, displayName)}
          rowMeta={(row) => (
            <FormattedMessage
              id="settings.approverGroups.memberCount"
              defaultMessage="{count, plural, one {# member} other {# members}}"
              values={{ count: row.memberCount }}
            />
          )}
          rowActions={(row) =>
            row.archivedAt ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="px-1.5"
                disabled={rowStatus[row.id] === "saving"}
                aria-label={intl.formatMessage(
                  { id: "settings.approverGroups.edit", defaultMessage: "Edit {name}" },
                  { name: row.displayName },
                )}
                onClick={() => setEditor({ target: row })}
              >
                <Pencil size={16} aria-hidden="true" className="text-muted" />
              </Button>
            )
          }
          archiveLabel={(row) =>
            intl.formatMessage(
              { id: "settings.approverGroups.archive", defaultMessage: "Archive {name}" },
              { name: row.displayName },
            )
          }
          onArchive={setArchiveTarget}
          restoreLabel={(row) =>
            intl.formatMessage(
              { id: "settings.approverGroups.restore", defaultMessage: "Restore {name}" },
              { name: row.displayName },
            )
          }
          onRestore={(row) => void restore(row)}
          listRef={listRef}
        />
      </div>
      {editor && (
        <GroupEditorDialog
          target={editor.target}
          people={people}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onRowChanged={replaceRow}
          onCreated={(row) => setRows((current) => insertByName(current, row))}
        />
      )}
      {archiveTarget && (
        <ArchiveGroupDialog
          target={archiveTarget}
          onOpenChange={(open) => {
            if (!open) setArchiveTarget(null);
          }}
          onArchived={replaceRow}
          onArchivedCloseFocus={() => listRef.current?.focus()}
        />
      )}
    </>
  );
}
