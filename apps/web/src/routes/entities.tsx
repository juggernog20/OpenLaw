// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry (ENT-001/ENT-004, #98), per the EN3 frame of
 * entities.pen reduced to the M7 registry subset: the list (legal name,
 * type, jurisdiction, status — ordered by legal name by the API), the
 * register dialog carrying the full identity card, and an empty state
 * that says what the registry is. The M27 surfaces the mock also draws
 * (view switcher, filters, obligations column, the record page) are not
 * built. The loader is the client half of ENT-004's gate — Member+
 * only; the API's 403 is the real refusal. M27 grows this destination
 * into the full module.
 */

import { useState } from "react";
import { redirect, useNavigate, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Building2, Landmark, Plus } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { problemDetail } from "../lib/messages";
import { isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

/** The fixed ENT-001 status enum — code branches on it, so it is a
 * constant here, not a fetched list. */
const ENTITY_STATUSES = ["active", "dormant", "dissolved", "divested"] as const;
type EntityStatus = (typeof ENTITY_STATUSES)[number];

/** One row of GET /entities, as the client sees it. */
interface EntityRow {
  id: string;
  legalName: string;
  entityTypeId: string;
  entityTypeName: string;
  jurisdiction: string | null;
  formedOn: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  registeredAgent: string | null;
  registeredAddress: string | null;
  status: EntityStatus;
  archivedAt: string | null;
}

interface EntityTypeOption {
  id: string;
  slug: string;
  displayName: string;
}

export async function entitiesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // ENT-004: Contributors and Business Users get nothing — not a
  // disabled surface, no surface. The API's 403 stands behind this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const [list, types] = await Promise.all([
    api.GET("/api/v1/entities"),
    api.GET("/api/v1/entities/types"),
  ]);
  if (!list.data || !types.data) throw new Error("The registry could not be read.");
  return { user, entities: list.data.entities, entityTypes: types.data.entityTypes };
}

/** EN3's status pills: active=success, dormant=warning, divested=
 * neutral (the mock's three); dissolved takes the danger pair — the
 * one terminal-negative state the mock has no row for. */
const STATUS_PILL: Record<EntityStatus, string> = {
  active: "bg-status-success-bg text-status-success-fg",
  dormant: "bg-status-warning-bg text-status-warning-fg",
  dissolved: "bg-status-danger-bg text-status-danger-fg",
  divested: "bg-badge-count-bg text-badge-count-fg",
};

function statusLabel(intl: IntlShape, status: EntityStatus): string {
  return intl.formatMessage(
    {
      id: "entities.statusLabel",
      defaultMessage:
        "{status, select, active {Active} dormant {Dormant} dissolved {Dissolved} " +
        "divested {Divested} other {Unknown}}",
    },
    { status },
  );
}

/** The list's resting order — the API's ordering, mirrored for rows
 * added after load. */
function byLegalName(a: EntityRow, b: EntityRow): number {
  return (
    a.legalName.localeCompare(b.legalName, undefined, { sensitivity: "base" }) ||
    a.legalName.localeCompare(b.legalName)
  );
}

export function EntitiesPage() {
  const { user, entities, entityTypes } = useLoaderData<typeof entitiesLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<EntityRow[]>(entities as EntityRow[]);
  const [registerOpen, setRegisterOpen] = useState(false);

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  const registerButton = (
    <Button onClick={() => setRegisterOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="entities.register" defaultMessage="Register entity" />
    </Button>
  );

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="entities.title" defaultMessage="Entities" />}
          subtitle={
            <FormattedMessage
              id="entities.count"
              defaultMessage="{count, plural, one {# entity} other {# entities}}"
              values={{ count: rows.length }}
            />
          }
          primaryAction={registerButton}
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "entities.title", defaultMessage: "Entities" })} />
      {rows.length === 0 ? (
        <EmptyRegistry onRegister={() => setRegisterOpen(true)} />
      ) : (
        <RegistryTable rows={rows} />
      )}
      {registerOpen && (
        <RegisterEntityDialog
          entityTypes={entityTypes}
          onOpenChange={setRegisterOpen}
          onRegistered={(row) => setRows((current) => [...current, row].sort(byLegalName))}
        />
      )}
    </AppShell>
  );
}

/** ENT-001's pitch, for the first visit (the M7 spec's empty state). */
function EmptyRegistry({ onRegister }: Readonly<{ onRegister: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      <Landmark size={24} aria-hidden="true" className="text-subtle" />
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">
          <FormattedMessage id="entities.empty.title" defaultMessage="No entities yet" />
        </h2>
        <p className="max-w-md text-base text-muted">
          <FormattedMessage
            id="entities.empty.body"
            defaultMessage={
              "The registry holds your own corporate entities — subsidiaries, " +
              "holding companies, and branches. Register them with their legal " +
              "details, and contracts pick the signing entity from this list."
            }
          />
        </p>
      </div>
      <Button onClick={onRegister}>
        <Plus size={16} aria-hidden="true" />
        <FormattedMessage id="entities.register" defaultMessage="Register entity" />
      </Button>
    </div>
  );
}

/** EN3's table, reduced to the M7 columns: name, type, jurisdiction,
 * status. The API orders the rows; this renders them. */
function RegistryTable({ rows }: Readonly<{ rows: EntityRow[] }>) {
  const intl = useIntl();
  return (
    <div className="overflow-x-auto rounded-card border border-border-default bg-raised">
      <table className="w-full">
        <thead>
          <tr className="bg-section-header text-start text-sm font-medium text-muted">
            <th scope="col" className="px-4 py-2 text-start font-medium">
              <FormattedMessage id="entities.column.legalName" defaultMessage="Legal name" />
            </th>
            <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
              <FormattedMessage id="entities.column.type" defaultMessage="Type" />
            </th>
            <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
              <FormattedMessage id="entities.column.jurisdiction" defaultMessage="Jurisdiction" />
            </th>
            <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
              <FormattedMessage id="entities.column.status" defaultMessage="Status" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border-default">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5 font-medium text-primary">
                  <Building2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  {row.legalName}
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm text-muted">{row.entityTypeName}</td>
              <td className="px-4 py-2.5 text-sm text-muted">
                {row.jurisdiction ?? (
                  <span aria-hidden="true" className="text-subtle">
                    —
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_PILL[row.status]}`}
                >
                  {statusLabel(intl, row.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The shared form-control look (ST8 normalization, C10 field spec). */
const CONTROL_CLASS =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-button border border-border-default bg-raised p-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

/** The identity card the register form collects (ENT-001): legal name
 * and type required, the rest optional. */
interface RegisterDraft {
  legalName: string;
  entityTypeId: string;
  status: EntityStatus;
  jurisdiction: string;
  formedOn: string;
  registrationNumber: string;
  taxId: string;
  registeredAgent: string;
  registeredAddress: string;
}

const EMPTY_DRAFT: RegisterDraft = {
  legalName: "",
  entityTypeId: "",
  status: "active",
  jurisdiction: "",
  formedOn: "",
  registrationNumber: "",
  taxId: "",
  registeredAgent: "",
  registeredAddress: "",
};

function RegisterEntityDialog({
  entityTypes,
  onOpenChange,
  onRegistered,
}: Readonly<{
  entityTypes: EntityTypeOption[];
  onOpenChange: (open: boolean) => void;
  onRegistered: (row: EntityRow) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<RegisterDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RegisterDraft>(key: K, value: RegisterDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (busy) return;
    setError(null);
    if (draft.legalName.trim() === "") {
      setError(
        intl.formatMessage({
          id: "entities.form.nameMissing",
          defaultMessage: "Name the entity — its registered legal name.",
        }),
      );
      return;
    }
    if (draft.entityTypeId === "") {
      setError(
        intl.formatMessage({
          id: "entities.form.typeMissing",
          defaultMessage: "Pick an entity type.",
        }),
      );
      return;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/entities", {
        body: {
          legalName: draft.legalName.trim(),
          entityTypeId: draft.entityTypeId,
          status: draft.status,
          jurisdiction: draft.jurisdiction.trim() || undefined,
          formedOn: draft.formedOn || undefined,
          registrationNumber: draft.registrationNumber.trim() || undefined,
          taxId: draft.taxId.trim() || undefined,
          registeredAgent: draft.registeredAgent.trim() || undefined,
          registeredAddress: draft.registeredAddress.trim() || undefined,
        },
      })
      .catch(() => ({ data: null, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "entities.form.registerError",
            defaultMessage: "The entity could not be registered.",
          }),
      );
      return;
    }
    onRegistered(data.entity as EntityRow);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="entities.form.title" defaultMessage="Register entity" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entity-legal-name">
              <FormattedMessage id="entities.form.legalName" defaultMessage="Legal name" />
            </Label>
            <Input
              id="entity-legal-name"
              autoFocus
              value={draft.legalName}
              onChange={(event) => set("legalName", event.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="entity-type">
                <FormattedMessage id="entities.form.type" defaultMessage="Entity type" />
              </Label>
              <select
                id="entity-type"
                value={draft.entityTypeId}
                className={CONTROL_CLASS}
                onChange={(event) => {
                  set("entityTypeId", event.target.value);
                  // Picking a type answers the pick-a-type refusal.
                  if (event.target.value !== "") setError(null);
                }}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "entities.form.typePlaceholder",
                    defaultMessage: "Type…",
                  })}
                </option>
                {entityTypes.map((entityType) => (
                  <option key={entityType.id} value={entityType.id}>
                    {entityType.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="entity-status">
                <FormattedMessage id="entities.form.status" defaultMessage="Status" />
              </Label>
              <select
                id="entity-status"
                value={draft.status}
                className={CONTROL_CLASS}
                onChange={(event) => set("status", event.target.value as EntityStatus)}
              >
                {ENTITY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(intl, status)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="entity-jurisdiction">
                <FormattedMessage
                  id="entities.form.jurisdiction"
                  defaultMessage="Formation jurisdiction"
                />
              </Label>
              <Input
                id="entity-jurisdiction"
                value={draft.jurisdiction}
                onChange={(event) => set("jurisdiction", event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="entity-formed-on">
                <FormattedMessage id="entities.form.formedOn" defaultMessage="Formed on" />
              </Label>
              <Input
                id="entity-formed-on"
                type="date"
                value={draft.formedOn}
                onChange={(event) => set("formedOn", event.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="entity-registration-number">
                <FormattedMessage
                  id="entities.form.registrationNumber"
                  defaultMessage="Registration no."
                />
              </Label>
              <Input
                id="entity-registration-number"
                value={draft.registrationNumber}
                onChange={(event) => set("registrationNumber", event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="entity-tax-id">
                <FormattedMessage id="entities.form.taxId" defaultMessage="Tax ID" />
              </Label>
              <Input
                id="entity-tax-id"
                value={draft.taxId}
                onChange={(event) => set("taxId", event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entity-registered-agent">
              <FormattedMessage
                id="entities.form.registeredAgent"
                defaultMessage="Registered agent"
              />
            </Label>
            <Input
              id="entity-registered-agent"
              value={draft.registeredAgent}
              onChange={(event) => set("registeredAgent", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entity-registered-address">
              <FormattedMessage
                id="entities.form.registeredAddress"
                defaultMessage="Registered address"
              />
            </Label>
            <textarea
              id="entity-registered-address"
              value={draft.registeredAddress}
              className={TEXTAREA_CLASS}
              onChange={(event) => set("registeredAddress", event.target.value)}
            />
          </div>
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
              <FormattedMessage id="entities.form.submit" defaultMessage="Register" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
