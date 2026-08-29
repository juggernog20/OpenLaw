// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry (ENT-001/ENT-004, #98/#99), per the EN3 frame
 * of entities.pen reduced to the M7 registry subset: the list (legal
 * name, type, jurisdiction, status — ordered by legal name by the API,
 * each row opening its record page), the register dialog carrying the
 * full identity card, an empty state that says what the registry is,
 * and the show-archived toggle that reveals archived entities with a
 * row-level restore (#99 — archiving is for data mistakes, so the way
 * back sits right where the mistake surfaces). The M27 surfaces the
 * mock also draws (view switcher, filters, obligations column) are not
 * built. The loader is the client half of ENT-004's gate — Member+
 * only; the API's 403 is the real refusal. M27 grows this destination
 * into the full module.
 */

import { useState, type ReactNode } from "react";
import { Form, Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Landmark,
  List,
  Network,
  Plus,
} from "lucide-react";
import { api } from "../lib/api";
import {
  ENTITY_STATUSES,
  STATUS_PILL,
  statusLabel,
  type CalendarObligation,
  type EntityRow,
  type EntityStatus,
  type EntityTypeOption,
} from "../lib/entities";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problem as readProblem } from "../lib/problem";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { EntityChart } from "../components/entities/entity-chart";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function entitiesLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser();
  // ENT-004: Contributors and Business Users get nothing — not a
  // disabled surface, no surface. The API's 403 stands behind this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const url = new URL(request.url);
  const requestedView = url.searchParams.get("view");
  const view: "calendar" | "list" | "chart" =
    requestedView === "chart" ? "chart" : requestedView === "list" ? "list" : "calendar";
  const query = {
    entity: url.searchParams.get("entity") ?? undefined,
    assignee: url.searchParams.get("assignee") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    includeCompleted:
      url.searchParams.get("includeCompleted") === "true" ? ("true" as const) : undefined,
  };
  const [list, types, chart, calendar, obligationOptions] = await Promise.all([
    api.GET("/api/v1/entities"),
    api.GET("/api/v1/entities/types"),
    view === "chart" ? api.GET("/api/v1/entities/chart") : Promise.resolve(undefined),
    view === "calendar"
      ? api.GET("/api/v1/entities/calendar", { params: { query } })
      : Promise.resolve(undefined),
    view === "calendar"
      ? api.GET("/api/v1/entities/obligation-options")
      : Promise.resolve(undefined),
  ]);
  if (!list.data || !types.data) throw new Error("The registry could not be read.");
  if (view === "chart" && !chart?.data) throw new Error("The Entity chart could not be read.");
  if (view === "calendar" && (!calendar?.data || !obligationOptions?.data)) {
    throw new Error("The compliance calendar could not be read.");
  }
  return {
    user,
    entities: list.data.entities,
    entityTypes: types.data.entityTypes,
    view,
    chart: chart?.data,
    calendar: calendar?.data?.obligations ?? [],
    obligationOptions: obligationOptions?.data ?? { users: [], matters: [] },
    filters: query,
    calendarView:
      url.searchParams.get("calendar") === "month" ? ("month" as const) : ("list" as const),
    month: url.searchParams.get("month"),
  };
}

/** Calendar, registry list, or ownership chart; the current link is marked. */
function ViewSwitch({ view }: Readonly<{ view: "calendar" | "list" | "chart" }>) {
  const intl = useIntl();
  const options = [
    [
      "calendar",
      "/entities",
      CalendarDays,
      intl.formatMessage({ id: "entities.view.calendar", defaultMessage: "Calendar" }),
    ],
    [
      "list",
      "/entities?view=list",
      List,
      intl.formatMessage({ id: "entities.view.list", defaultMessage: "List" }),
    ],
    [
      "chart",
      "/entities?view=chart",
      Network,
      intl.formatMessage({ id: "entities.view.chart", defaultMessage: "Chart" }),
    ],
  ] as const;
  return (
    <nav
      aria-label={intl.formatMessage({
        id: "entities.view.label",
        defaultMessage: "Registry view",
      })}
      className="mr-auto inline-flex h-8 rounded-button border border-border-default bg-raised p-0.5"
    >
      {options.map(([key, to, Icon, label]) => (
        <Link
          key={key}
          to={to}
          aria-current={view === key ? "page" : undefined}
          className="inline-flex items-center gap-1.5 rounded-chip px-2.5 text-sm aria-[current=page]:bg-accent aria-[current=page]:font-medium"
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
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
  const loaded = useLoaderData<typeof entitiesLoader>();
  const { user, entities, entityTypes, view, chart } = loaded;
  const intl = useIntl();
  const [rows, setRows] = useState<EntityRow[]>(entities);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  /** The working registry — archived rows never count (they are data
   * mistakes, not entities), whichever view is showing. */
  const liveCount = rows.filter((row) => row.archivedAt === null).length;

  const signOut = useSignOut("/auth/login");

  /** #99's show-archived toggle re-reads the list either way — the
   * archived rows only exist server-side, and coming back should not
   * trust a stale working list either. */
  async function toggleArchived(next: boolean) {
    setListError(null);
    const { data } = await api
      .GET(
        "/api/v1/entities",
        next ? { params: { query: { includeArchived: "true" as const } } } : {},
      )
      .catch(() => ({ data: undefined }));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "entities.listError",
          defaultMessage: "The registry could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.entities);
    setShowArchived(next);
  }

  /** Row-level restore, offered in the archived view (#99). */
  async function restoreRow(row: EntityRow) {
    setListError(null);
    const result = await api
      .POST("/api/v1/entities/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => undefined);
    if (!result?.data) {
      setListError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "entities.restoreError",
            defaultMessage: "The entity could not be restored.",
          }),
      );
      return;
    }
    const data = result.data;
    const restored = data.entity;
    setRows((current) => current.map((existing) => (existing.id === row.id ? restored : existing)));
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
              values={{ count: liveCount }}
            />
          }
          primaryAction={registerButton}
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "entities.title", defaultMessage: "Entities" })} />
      {view === "calendar" ? (
        <ComplianceCalendar
          rows={loaded.calendar}
          entities={rows}
          users={loaded.obligationOptions.users}
          filters={loaded.filters}
          initialView={loaded.calendarView}
          initialMonth={loaded.month}
        />
      ) : view === "chart" && chart ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-end gap-2">
            <ViewSwitch view={view} />
          </div>
          <EntityChart chart={chart} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-end gap-2">
            <ViewSwitch view={view} />
            {listError && (
              <p role="alert" className="text-xs text-status-danger-fg">
                {listError}
              </p>
            )}
            <Label htmlFor="entities-show-archived">
              <FormattedMessage id="entities.showArchived" defaultMessage="Show archived" />
            </Label>
            <Switch
              id="entities-show-archived"
              checked={showArchived}
              onCheckedChange={(next) => void toggleArchived(next)}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyRegistry onRegister={() => setRegisterOpen(true)} />
          ) : (
            <RegistryTable
              rows={rows}
              showArchived={showArchived}
              onRestore={(row) => void restoreRow(row)}
            />
          )}
        </div>
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

function ComplianceCalendar({
  rows,
  entities,
  users,
  filters,
  initialView,
  initialMonth,
}: Readonly<{
  rows: CalendarObligation[];
  entities: EntityRow[];
  users: readonly { id: string; displayName: string }[];
  filters: {
    entity?: string;
    assignee?: string;
    from?: string;
    to?: string;
    includeCompleted?: "true";
  };
  initialView: "list" | "month";
  initialMonth: string | null;
}>) {
  const filtered = Boolean(
    filters.entity || filters.assignee || filters.from || filters.to || filters.includeCompleted,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ViewSwitch view="calendar" />
        <nav
          aria-label="Calendar display"
          className="inline-flex rounded-button border border-border-default bg-raised p-0.5"
        >
          <Link
            to="/entities"
            aria-current={initialView === "list" ? "page" : undefined}
            className="rounded-chip px-2.5 py-1 text-sm aria-[current=page]:bg-accent aria-[current=page]:font-medium"
          >
            Due-date list
          </Link>
          <Link
            to="/entities?calendar=month"
            aria-current={initialView === "month" ? "page" : undefined}
            className="rounded-chip px-2.5 py-1 text-sm aria-[current=page]:bg-accent aria-[current=page]:font-medium"
          >
            Month
          </Link>
        </nav>
      </div>
      <section className="rounded-card border border-border-default bg-raised p-4">
        <h2 className="text-lg font-semibold">Compliance calendar</h2>
        <Form
          method="get"
          className="mt-3 grid grid-cols-1 gap-3 @xl/page:grid-cols-[1fr_1fr_10rem_10rem_auto_auto]"
        >
          {initialView === "month" ? <input type="hidden" name="calendar" value="month" /> : null}
          <CalendarSelect
            id="calendar-entity"
            label="Entity"
            name="entity"
            defaultValue={filters.entity}
          >
            <option value="">All Entities</option>
            {entities
              .filter((row) => row.archivedAt === null)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.legalName}
                </option>
              ))}
          </CalendarSelect>
          <CalendarSelect
            id="calendar-assignee"
            label="Assignee"
            name="assignee"
            defaultValue={filters.assignee}
          >
            <option value="">Everyone</option>
            {users.map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName}
              </option>
            ))}
          </CalendarSelect>
          <FieldLabel id="calendar-from" label="From">
            <Input id="calendar-from" name="from" type="date" defaultValue={filters.from} />
          </FieldLabel>
          <FieldLabel id="calendar-to" label="To">
            <Input id="calendar-to" name="to" type="date" defaultValue={filters.to} />
          </FieldLabel>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              name="includeCompleted"
              value="true"
              defaultChecked={filters.includeCompleted === "true"}
            />
            Include completed
          </label>
          <Button type="submit" variant="secondary" className="self-end">
            Apply
          </Button>
        </Form>
      </section>
      {rows.length === 0 ? (
        <CalendarEmpty
          filtered={filtered}
          firstEntityId={entities.find((row) => row.archivedAt === null)?.id}
        />
      ) : initialView === "month" ? (
        <MonthCalendar rows={rows} initialMonth={initialMonth} />
      ) : (
        <CalendarList rows={rows} />
      )}
    </div>
  );
}

function CalendarSelect({
  id,
  label,
  name,
  defaultValue,
  children,
}: Readonly<{
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
  children: ReactNode;
}>) {
  return (
    <FieldLabel id={id} label={label}>
      <select id={id} name={name} defaultValue={defaultValue ?? ""} className={CONTROL_CLASS}>
        {children}
      </select>
    </FieldLabel>
  );
}

function FieldLabel({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function CalendarEmpty({
  filtered,
  firstEntityId,
}: Readonly<{ filtered: boolean; firstEntityId?: string }>) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-14 text-center">
      <CalendarDays size={24} className="text-subtle" aria-hidden="true" />
      <div>
        <h2 className="text-md font-semibold">
          {filtered ? "No obligations match" : "No obligations yet"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {filtered
            ? "Change or clear the filters to see other due dates."
            : "Obligations added to Entity records appear here."}
        </p>
      </div>
      {filtered ? (
        <Link className="text-link hover:underline" to="/entities">
          Clear all
        </Link>
      ) : firstEntityId ? (
        <Link className="text-link hover:underline" to={`/entities/${firstEntityId}/obligations`}>
          Add obligation
        </Link>
      ) : null}
    </div>
  );
}

function CalendarList({ rows }: Readonly<{ rows: CalendarObligation[] }>) {
  return (
    <div className="overflow-x-auto rounded-card border border-border-default bg-raised">
      <table className="w-full">
        <thead>
          <tr className="bg-section-header text-sm text-muted">
            <CalendarHeader>Due date</CalendarHeader>
            <CalendarHeader>Obligation</CalendarHeader>
            <CalendarHeader>Entity</CalendarHeader>
            <CalendarHeader>Assignee</CalendarHeader>
            <CalendarHeader>Repeat</CalendarHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border-default">
              <td
                className={`px-4 py-3 text-sm ${row.overdue ? "text-status-danger-fg" : "text-muted"}`}
              >
                {formatDay(row.nextDueOn)}
              </td>
              <td className="px-4 py-3">
                <Link
                  to={`/entities/${row.entityId}/obligations`}
                  className={`font-medium hover:underline ${row.overdue ? "text-status-danger-fg" : "text-link"}`}
                >
                  {row.label}
                </Link>
                {row.completedOn ? (
                  <span className="ms-2 rounded-pill bg-status-success-bg px-2 py-0.5 text-xs text-status-success-fg">
                    Filed
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <Link className="text-link hover:underline" to={`/entities/${row.entityId}`}>
                  {row.entity.legalName}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-muted">
                {row.assignee?.displayName ?? "Unassigned"}
              </td>
              <td className="px-4 py-3 text-sm text-muted">
                {row.recurrenceMonths ? `Every ${row.recurrenceMonths} months` : "One-off"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalendarHeader({ children }: Readonly<{ children: string }>) {
  return (
    <th scope="col" className="px-4 py-2 text-start font-medium">
      {children}
    </th>
  );
}

function MonthCalendar({
  rows,
  initialMonth,
}: Readonly<{ rows: CalendarObligation[]; initialMonth: string | null }>) {
  const [month, setMonth] = useState(() => parseMonth(initialMonth));
  const title = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(month);
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const start = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday));
  const days = Array.from({ length: 42 }, (_, offset) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    return day;
  });
  function step(delta: number) {
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));
  }
  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMonth(currentMonth())}>
            Today
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => step(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </header>
      <div role="grid" aria-label={title} className="grid grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <div
            role="columnheader"
            key={weekday}
            className="border-b border-e border-border-muted bg-section-header px-2 py-2 text-center text-xs font-medium text-muted"
          >
            {weekday}
          </div>
        ))}
        {days.map((day) => {
          const key = isoDay(day);
          const held = rows.filter((row) => row.nextDueOn === key);
          const inMonth = day.getUTCMonth() === monthIndex;
          return (
            <div
              role="gridcell"
              key={key}
              className="min-h-28 border-b border-e border-border-muted p-2"
            >
              <span className={`text-xs ${inMonth ? "text-primary" : "text-subtle"}`}>
                {day.getUTCDate()}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {held.map((row) => (
                  <Link
                    key={row.id}
                    to={`/entities/${row.entityId}/obligations`}
                    className={`rounded-chip px-1.5 py-1 text-xs hover:underline ${row.overdue ? "bg-status-danger-bg text-status-danger-fg" : "bg-accent text-link"}`}
                  >
                    {row.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parseMonth(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return currentMonth();
  const month = Number(match[2]);
  return month >= 1 && month <= 12
    ? new Date(Date.UTC(Number(match[1]), month - 1, 1))
    : currentMonth();
}

function currentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

function isoDay(day: Date) {
  return day.toISOString().slice(0, 10);
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
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

/** EN3's table, reduced to the M7 columns: name (opening the record
 * page, #99), type, jurisdiction, status. The API orders the rows;
 * this renders them. The archived view adds an Archived pill and a
 * row-level restore. */
function RegistryTable({
  rows,
  showArchived,
  onRestore,
}: Readonly<{
  rows: EntityRow[];
  showArchived: boolean;
  onRestore: (row: EntityRow) => void;
}>) {
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
            {showArchived && (
              <th scope="col" className="w-24 px-4 py-2 text-end font-medium">
                <span className="sr-only">
                  <FormattedMessage id="entities.column.actions" defaultMessage="Actions" />
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border-default">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <Building2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  <Link
                    to={`/entities/${row.id}`}
                    className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                  >
                    {row.legalName}
                  </Link>
                  {row.archivedAt !== null && (
                    <span className="inline-flex rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                      <FormattedMessage id="entities.archivedPill" defaultMessage="Archived" />
                    </span>
                  )}
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
              {showArchived && (
                <td className="px-4 py-2.5 text-end">
                  {row.archivedAt !== null && (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={intl.formatMessage(
                        { id: "entities.restoreRow", defaultMessage: "Restore {name}" },
                        { name: row.legalName },
                      )}
                      onClick={() => onRestore(row)}
                    >
                      <FormattedMessage id="entities.record.restore" defaultMessage="Restore" />
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
    const result = await api
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
      .catch(() => undefined);
    const { data } = result ?? {};
    setBusy(false);
    if (!data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "entities.form.registerError",
            defaultMessage: "The entity could not be registered.",
          }),
      );
      return;
    }
    onRegistered(data.entity);
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
                {ENTITY_STATUSES.map((status: EntityStatus) => (
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
