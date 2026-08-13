// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts destination (M8), reduced to what the contract record
 * carries so far: the list (reference, title, primary counterparty,
 * type, status, value, Owner — ordered newest reference first by the
 * API, each row opening its record page at `/contracts/<number>`), the
 * create dialog that takes a title, a type, and whatever fields that
 * type hard-requires (CTR-016/MTR-014 — the dialog grows them the
 * moment a type is picked, and creation is refused while one is empty),
 * an empty state that says what the module is, and the show-archived
 * toggle with a row-level restore. The C1 mock's remaining columns — risk and expiry — join
 * with the tickets that add those fields to the record.
 *
 * The destination takes Member+ and Contributors (CTR-021). A Contributor's
 * list is the contracts they hold a `contract_team` row on — the API
 * does that narrowing, and an empty answer is the list's own empty
 * state, never a refusal. The page reads for them: no create, no
 * restore, no picker reads. Business Users are bounced home; the API's
 * 403 is the real refusal.
 */

import { useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { FilePen, FileText, Plus } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  contractReference,
  formatContractValue,
  STAGE_PILL,
  type ContractRow,
  type ContractTypeOption,
  type RegistryEntity,
  type UserOption,
} from "../lib/contracts";
import {
  emptyDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../lib/custom-fields";
import { CONTROL_CLASS } from "../lib/form-controls";
import { problemDetail } from "../lib/messages";
import { canReadContracts, isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { Avatar } from "../components/avatar";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function contractsLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // A Business User gets no surface at all, not a disabled one. The
  // API's 403 stands behind this.
  if (!canReadContracts(user.role)) return redirect("/");
  // Whether this viewer may change anything from the list — create a
  // contract, or restore an archived one. Both are Member+, and so are
  // the two picker reads the create dialog needs. A Contributor asks
  // for neither: both seams refuse them, and a page with no create
  // dialog has nothing to fill.
  const canEdit = isMemberPlus(user.role);
  const [list, options, registry] = await Promise.all([
    api.GET("/api/v1/contracts"),
    // The create dialog grows the picked type's hard-required fields
    // (CTR-016), and two of the nine field types name a row: a person
    // or one of our Entities. The people ride the options read; the
    // Entities are the M7 registry's own Member+ list, the same source
    // the record's signing-entity picker reads.
    canEdit ? api.GET("/api/v1/contracts/options") : undefined,
    canEdit ? api.GET("/api/v1/entities") : undefined,
  ]);
  if (!list.data || (canEdit && !(options?.data && registry?.data))) {
    throw new Error("The contract list could not be read.");
  }
  return {
    user,
    canEdit,
    contracts: list.data.contracts,
    contractTypes: options?.data?.contractTypes ?? [],
    users: options?.data?.users ?? [],
    entities: registry?.data?.entities ?? [],
  };
}

export function ContractsPage() {
  const { user, canEdit, contracts, contractTypes, users, entities } =
    useLoaderData<typeof contractsLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ContractRow[]>(contracts);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  /** One list-level request at a time: a second toggle or restore
   * launched mid-flight would race the first, and the loser's answer
   * would overwrite the winner's list. */
  const [listBusy, setListBusy] = useState(false);

  /** The working list — archived rows never count, whichever view is
   * showing (they are mistakes, not contracts). */
  const liveCount = rows.filter((row) => row.archivedAt === null).length;

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  /** The toggle re-reads either way: archived rows only exist
   * server-side, and coming back should not trust a stale list either. */
  async function toggleArchived(next: boolean) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data } = await api
      .GET(
        "/api/v1/contracts",
        next ? { params: { query: { includeArchived: "true" as const } } } : {},
      )
      .catch(() => ({ data: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "contracts.listError",
          defaultMessage: "The contract list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.contracts);
    setShowArchived(next);
  }

  /** Row-level restore, offered in the archived view — archiving is for
   * mistakes, so the way back sits where the mistake surfaces. */
  async function restoreRow(row: ContractRow) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data, error } = await api
      .POST("/api/v1/contracts/{number}/restore", { params: { path: { number: row.number } } })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        problemDetail(error) ??
          intl.formatMessage(
            {
              id: "contracts.restoreError",
              defaultMessage: "{reference} could not be restored.",
            },
            { reference: contractReference(intl, row.number) },
          ),
      );
      return;
    }
    const restored = data.contract;
    setRows((current) => current.map((existing) => (existing.id === row.id ? restored : existing)));
  }

  /** Absent, not disabled, for a read-only viewer — the same
   * convention the nav and the settings rail follow (SET-002). */
  const createButton = canEdit ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
    </Button>
  ) : undefined;

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="contracts.title" defaultMessage="Contracts" />}
          subtitle={
            <FormattedMessage
              id="contracts.count"
              defaultMessage="{count, plural, one {# contract} other {# contracts}}"
              values={{ count: liveCount }}
            />
          }
          primaryAction={createButton}
        />
      }
    >
      <PageTitle
        title={intl.formatMessage({ id: "contracts.title", defaultMessage: "Contracts" })}
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          {listError && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {listError}
            </p>
          )}
          <Label htmlFor="contracts-show-archived">
            <FormattedMessage id="contracts.showArchived" defaultMessage="Show archived" />
          </Label>
          <Switch
            id="contracts-show-archived"
            checked={showArchived}
            disabled={listBusy}
            onCheckedChange={(next) => void toggleArchived(next)}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyContracts
            archived={showArchived}
            onCreate={canEdit ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <ContractsTable
            rows={rows}
            showArchived={showArchived}
            busy={listBusy}
            // Restore is a mutation, so a read-only viewer is offered
            // no way to ask for one.
            onRestore={canEdit ? (row) => void restoreRow(row) : undefined}
          />
        )}
      </div>
      {createOpen && (
        <CreateContractDialog
          contractTypes={contractTypes}
          people={users.map((person: UserOption) => ({
            id: person.id,
            label: person.displayName,
            archived: person.archived,
          }))}
          entities={entities.map((entity: RegistryEntity) => ({
            id: entity.id,
            label: entity.legalName,
          }))}
          onOpenChange={setCreateOpen}
          onCreated={(row) => setRows((current) => [row, ...current])}
        />
      )}
    </AppShell>
  );
}

/** The module's pitch, for the first visit. The C17 mock's second route
 * in — convert an intake request from the Inbox — waits for intake
 * (M20/M21), so the first visit is offered the one door that exists.
 * A Contributor gets the same empty state with no door: they are on no
 * contract yet, and being added to one is what puts a row here. */
function EmptyContracts({
  archived,
  onCreate,
}: Readonly<{ archived: boolean; onCreate?: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      {/* The destination's own glyph, as the C17 mock and the nav draw it. */}
      <FilePen size={24} aria-hidden="true" className="text-subtle" />
      {/* One static id per line, so every one of them is extracted —
          a composed id is a message the catalog never sees (DES-013). */}
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">
          {archived ? (
            <FormattedMessage
              id="contracts.empty.archived.title"
              defaultMessage="No archived contracts"
            />
          ) : (
            <FormattedMessage id="contracts.empty.title" defaultMessage="No contracts yet" />
          )}
        </h2>
        <p className="max-w-md text-base text-muted">
          {archived ? (
            <FormattedMessage
              id="contracts.empty.archived.body"
              defaultMessage="Archived contracts are kept out of the way until they are restored."
            />
          ) : onCreate ? (
            <FormattedMessage
              id="contracts.empty.body"
              defaultMessage={
                "A contract is the workspace for work that ends in a signed " +
                "document. Create one when a deal starts; it takes a reference " +
                "you can quote in email."
              }
            />
          ) : (
            // A Contributor cannot make the first one: being added to a
            // contract's team is what puts a row here (DD-015).
            <FormattedMessage
              id="contracts.empty.readOnly.body"
              defaultMessage={
                "Contracts you are added to appear here. Ask a Legal Team " +
                "Member to add you to the ones you work on."
              }
            />
          )}
        </p>
      </div>
      {!archived && onCreate && (
        <Button onClick={onCreate}>
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
        </Button>
      )}
    </div>
  );
}

/** The list, reduced to the columns the record core carries. The API
 * orders the rows; this renders them. The archived view adds an
 * Archived pill and, for a viewer who may restore, a row-level restore. */
function ContractsTable({
  rows,
  showArchived,
  busy,
  onRestore,
}: Readonly<{
  rows: ContractRow[];
  showArchived: boolean;
  /** A list-level request is in flight; row actions stand down. */
  busy: boolean;
  /** Absent for a read-only viewer, so no restore is offered at all. */
  onRestore?: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  /** The actions column exists only where an action does. */
  const actions = showArchived && onRestore !== undefined;
  return (
    <div className="overflow-x-auto rounded-card border border-border-default bg-raised">
      <table className="w-full">
        <thead>
          <tr className="bg-section-header text-start text-sm font-medium text-muted">
            <th scope="col" className="w-24 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.reference" defaultMessage="Reference" />
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.title" defaultMessage="Title" />
            </th>
            {/* Their side, where the C1 mock draws it: straight after
                the title, because "who is this with" is the second
                thing a reader scans for. */}
            <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.counterparty" defaultMessage="Counterparty" />
            </th>
            <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.type" defaultMessage="Type" />
            </th>
            <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.status" defaultMessage="Status" />
            </th>
            {/* What the contract is worth, where the C1 mock draws it:
                after the status and before the Owner. */}
            <th scope="col" className="w-40 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.value" defaultMessage="Value" />
            </th>
            <th scope="col" className="w-48 px-4 py-2 text-start font-medium">
              <FormattedMessage id="contracts.column.owner" defaultMessage="Owner" />
            </th>
            {actions && (
              <th scope="col" className="w-24 px-4 py-2 text-end font-medium">
                <span className="sr-only">
                  <FormattedMessage id="contracts.column.actions" defaultMessage="Actions" />
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border-default">
              <td className="px-4 py-2.5 text-sm text-muted">
                {contractReference(intl, row.number)}
              </td>
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  <Link
                    to={`/contracts/${row.number}`}
                    className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                  >
                    {row.title}
                  </Link>
                  {row.archivedAt !== null && (
                    <span className="inline-flex rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                      <FormattedMessage id="contracts.archivedPill" defaultMessage="Archived" />
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm">
                {row.primaryCounterparty ? (
                  // One name per row: the primary is what a list can
                  // show, and the record holds the rest (CTR-011).
                  // The width rides the cell's own content, not the
                  // column hint: a table cell grows to fit, so a long
                  // name needs something to be truncated against.
                  <span className="block w-44 truncate">{row.primaryCounterparty.name}</span>
                ) : (
                  <span className="text-muted">
                    <FormattedMessage
                      id="contracts.counterpartyNone"
                      defaultMessage="None recorded"
                    />
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-sm text-muted">{row.contractTypeName}</td>
              <td className="px-4 py-2.5">
                <span
                  className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[row.stage]}`}
                >
                  {row.statusName}
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm">
                {row.value ? (
                  formatContractValue(intl, row.value)
                ) : (
                  // No value recorded is a real state, not a gap: an
                  // NDA is worth nothing and says nothing (CTR-010).
                  <span className="text-muted">
                    <FormattedMessage id="contracts.valueNone" defaultMessage="No value" />
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5">
                {row.manager ? (
                  <span
                    className={`flex min-w-0 items-center gap-2 ${row.manager.archived ? "opacity-50" : ""}`}
                  >
                    <Avatar
                      name={row.manager.displayName}
                      image={row.manager.image}
                      className="size-6"
                    />
                    <span className="truncate text-sm">{row.manager.displayName}</span>
                  </span>
                ) : (
                  // Unassigned is a real state — the contract is in
                  // triage until someone takes it (CTR-004).
                  <span className="text-sm text-muted">
                    <FormattedMessage id="contracts.ownerUnassigned" defaultMessage="Unassigned" />
                  </span>
                )}
              </td>
              {actions && (
                <td className="px-4 py-2.5 text-end">
                  {row.archivedAt !== null && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      aria-label={intl.formatMessage(
                        { id: "contracts.restoreRow", defaultMessage: "Restore {title}" },
                        { title: row.title },
                      )}
                      onClick={() => onRestore(row)}
                    >
                      <FormattedMessage id="contracts.record.restore" defaultMessage="Restore" />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Creation is deliberately minimal: a title, a type, and whatever that
 * type hard-requires (CTR-016/MTR-014 — the dialog grows the required
 * fields as soon as a type is picked, so a contract cannot be born
 * missing data its type demands). The status starts on the protected
 * draft seed, and everything else is set inline on the record afterward
 * (DES-017). */
function CreateContractDialog({
  contractTypes,
  people,
  entities,
  onOpenChange,
  onCreated,
}: Readonly<{
  contractTypes: ContractTypeOption[];
  /** What a required `user` field offers. */
  people: readonly FieldReference[];
  /** What a required `entity` field offers — the M7 registry. */
  entities: readonly FieldReference[];
  onOpenChange: (open: boolean) => void;
  onCreated: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  const [title, setTitle] = useState("");
  const [contractTypeId, setContractTypeId] = useState("");
  /** The required fields' drafts, keyed by slug. They survive switching
   * types and back — a name typed once should not have to be typed
   * again because someone checked another type on the way. */
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, CustomFieldDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What the picked type demands. Nothing until a type is picked —
   * the dialog cannot ask for a type's fields before it has a type. */
  const required =
    contractTypes
      .find((contractType) => contractType.id === contractTypeId)
      ?.fields.filter((field) => field.isRequired) ?? [];

  async function submit() {
    if (busy) return;
    setError(null);
    if (title.trim() === "") {
      setError(
        intl.formatMessage({
          id: "contracts.form.titleMissing",
          defaultMessage: "Name the contract.",
        }),
      );
      return;
    }
    if (contractTypeId === "") {
      setError(
        intl.formatMessage({
          id: "contracts.form.typeMissing",
          defaultMessage: "Pick a contract type.",
        }),
      );
      return;
    }
    // The type's own demands, checked where the person can answer them.
    // The seam refuses an empty one too — this only saves a round trip.
    const customFields: Record<string, CustomFieldValue> = {};
    for (const field of required) {
      const parsed = toValue(field, fieldDrafts[field.slug] ?? emptyDraft(field));
      if ("error" in parsed) {
        setError(
          intl.formatMessage(
            {
              id: "contracts.field.numberInvalidNamed",
              defaultMessage: "{fieldName}: enter this as a number.",
            },
            { fieldName: field.displayName },
          ),
        );
        return;
      }
      if (parsed.value === null) {
        setError(
          intl.formatMessage(
            {
              id: "contracts.form.fieldMissing",
              defaultMessage: "Fill {field} — this contract type requires it.",
            },
            { field: field.displayName },
          ),
        );
        return;
      }
      customFields[field.slug] = parsed.value;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/contracts", { body: { title: title.trim(), contractTypeId, customFields } })
      .catch(() => ({ data: null, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.form.createError",
            defaultMessage: "The contract could not be created.",
          }),
      );
      return;
    }
    onCreated(data.contract);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="contracts.form.title" defaultMessage="Create contract" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-title">
              <FormattedMessage id="contracts.form.titleField" defaultMessage="Title" />
            </Label>
            <Input
              id="contract-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-type">
              <FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />
            </Label>
            <select
              id="contract-type"
              value={contractTypeId}
              className={CONTROL_CLASS}
              onChange={(event) => {
                setContractTypeId(event.target.value);
                // Picking a type answers the pick-a-type refusal.
                if (event.target.value !== "") setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({
                  id: "contracts.form.typePlaceholder",
                  defaultMessage: "Type…",
                })}
              </option>
              {contractTypes.map((contractType) => (
                <option key={contractType.id} value={contractType.id}>
                  {contractType.displayName}
                </option>
              ))}
            </select>
          </div>
          {/* The type's hard-required fields, grown into the dialog the
              moment a type is picked (CTR-016/MTR-014). The optional
              ones are not here: they are set inline on the record, and
              creation stays the smallest thing that makes a record. */}
          {required.map((field) => (
            <div key={field.slug} className="flex flex-col gap-1.5">
              <Label id={`contract-new-${field.slug}-label`} htmlFor={`contract-new-${field.slug}`}>
                {field.displayName}
                <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                  *
                </span>
                <span className="sr-only">
                  <FormattedMessage id="contracts.field.requiredMark" defaultMessage="(required)" />
                </span>
              </Label>
              <CustomFieldControl
                id={`contract-new-${field.slug}`}
                field={field}
                draft={fieldDrafts[field.slug] ?? emptyDraft(field)}
                people={people}
                entities={entities}
                describedBy={field.description ? `contract-new-${field.slug}-help` : undefined}
                onDraft={(next) => {
                  setFieldDrafts((current) => ({ ...current, [field.slug]: next }));
                  setError(null);
                }}
              />
              {field.description && (
                <p id={`contract-new-${field.slug}-help`} className="text-xs text-muted">
                  {field.description}
                </p>
              )}
            </div>
          ))}
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contracts.form.draftNote"
              defaultMessage="New contracts start in Draft. Set everything else on the record."
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
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="contracts.form.submit" defaultMessage="Create" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
