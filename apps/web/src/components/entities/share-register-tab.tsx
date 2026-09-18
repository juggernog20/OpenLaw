// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Ownership tab as a share register (ENT-011, DES-088): Register as
 * of, the reconciliation line, the Register of members, the Register of
 * allotments and transfers, then the Entities this one owns. Holders are
 * never added here; they come from entries.
 */
import { useState, type ReactNode } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityHoldings, EntityRow } from "../../lib/entities";
import { toMajorUnits } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  entryKindLabel,
  entryKindPillClass,
  filterEntries,
  holderLabel,
  knownHolders,
  REGISTER_FILTER_KEYS,
  SHARE_ENTRY_KINDS,
  type RegisterEntry,
  type RegisterRow,
  type ShareRegister,
} from "../../lib/share-register";
import { cn } from "../../lib/utils";
import { DatePicker } from "../date-picker";
import { RestrictedRecordCell } from "../restricted-record-cell";
import { RecordFilterBar, type RecordFilter } from "../table/record-filter-bar";
import { Button } from "../ui/button";
import { OwnershipCard } from "./ownership-card";
import { ShareClassesDialog } from "./share-classes-dialog";
import { ShareEntryDialog } from "./share-entry-dialog";

const RESTRICTED = { id: "entities.restricted", defaultMessage: "Restricted Entity" };

function formatDay(intl: IntlShape, iso: string) {
  return intl.formatDate(new Date(`${iso}T12:00:00Z`), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMonth(intl: IntlShape, iso: string) {
  return intl.formatDate(new Date(`${iso}T12:00:00Z`), {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** DES-006: percentages through Intl, one fraction digit. */
const percent = (intl: IntlShape, value: number) =>
  intl.formatNumber(value / 100, { style: "percent", maximumFractionDigits: 1 });

export function ShareRegisterTab({
  entity,
  register,
  holdings,
  candidates,
  frozen,
}: Readonly<{
  entity: EntityRow;
  register: ShareRegister;
  holdings: EntityHoldings;
  candidates: EntityRow[];
  frozen: boolean;
}>) {
  const intl = useIntl();
  const [params, setParams] = useSearchParams();
  const { revalidate } = useRevalidator();
  const [classesOpen, setClassesOpen] = useState(false);
  const [entryDialog, setEntryDialog] = useState<{ entry?: RegisterEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const historic = register.asOf !== register.today;
  const live = register.classes.filter((row) => row.archivedAt === null);
  const empty = live.length === 0 && register.entries.length === 0;

  function setAsOf(next: string | null) {
    const search = new URLSearchParams(params);
    if (next && next !== register.today) search.set("asOf", next);
    else search.delete("asOf");
    setParams(search);
  }

  const filters: Record<string, boolean | string> = {};
  for (const key of REGISTER_FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  function setFilters(next: Record<string, boolean | string>) {
    const search = new URLSearchParams(params);
    for (const key of REGISTER_FILTER_KEYS) search.delete(key);
    for (const key of REGISTER_FILTER_KEYS) {
      const value = next[key];
      if (typeof value === "string" && value) search.set(key, value);
    }
    setParams(search);
  }

  async function remove(entry: RegisterEntry) {
    setError(null);
    const result = await api
      .DELETE("/api/v1/entities/{id}/share-entries/{entryId}", {
        params: { path: { id: entity.id, entryId: entry.id } },
      })
      .catch(() => undefined);
    if (!result?.response.ok) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.register.entry.removeError",
            defaultMessage: "The entry could not be removed.",
          }),
      );
      return;
    }
    void revalidate();
  }

  const classNames = new Map(register.classes.map((row) => [row.id, row.name]));
  const definitions: RecordFilter[] = [
    {
      key: "class",
      label: intl.formatMessage({ id: "entities.register.entry.class", defaultMessage: "Class" }),
      kind: "choices",
      choices: register.classes.map((row) => ({ id: row.id, displayName: row.name })),
    },
    {
      key: "kind",
      label: intl.formatMessage({ id: "entities.register.entry.kind", defaultMessage: "Entry" }),
      kind: "choices",
      choices: SHARE_ENTRY_KINDS.map((kind) => ({
        id: kind,
        displayName: entryKindLabel(intl, kind),
      })),
    },
    {
      key: "holder",
      label: intl.formatMessage({ id: "entities.register.holder", defaultMessage: "Holder" }),
      kind: "choices",
      choices: knownHolders(register).map((holder) => ({
        id: holder.id,
        displayName: holder.name,
      })),
    },
    {
      key: "effective",
      label: intl.formatMessage({
        id: "entities.register.entry.effectiveOn",
        defaultMessage: "Effective date",
      }),
      kind: "date",
    },
  ];
  const shown = filterEntries(register.entries, filters);
  // A hand-typed owner the register now names would list twice. Match
  // Entity owners by id only: two individuals sharing a name are not one person.
  const registeredEntityIds = new Set(
    knownHolders(register).flatMap((holder) => (holder.entityId ? [holder.entityId] : [])),
  );
  const declaredHoldings = {
    ...holdings,
    owners: holdings.owners.filter(
      (row) =>
        row.owner.restricted ||
        row.owner.kind === "individual" ||
        !registeredEntityIds.has(row.owner.id),
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <RegisterAsOf register={register} onChange={setAsOf} />
      <ReconciliationNote register={register} />
      {register.warnings.map((warning) => (
        <p
          key={warning.shareClassId}
          role="alert"
          className="rounded-card border border-status-warning-fg bg-status-warning-bg px-3 py-2 text-sm text-status-warning-fg"
        >
          <FormattedMessage
            id="entities.register.overAuthorized"
            defaultMessage="{issued} {className} shares are issued against {authorized} authorized."
            values={{
              issued: intl.formatNumber(warning.issued),
              authorized: intl.formatNumber(warning.authorized),
              className: warning.className,
            }}
          />
        </p>
      ))}
      {empty ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-14 text-center">
          <h2 className="text-md font-semibold">
            <FormattedMessage id="entities.register.empty" defaultMessage="No share register yet" />
          </h2>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="entities.register.emptyHint"
              defaultMessage="Add a share class, then record the first allotment. Holders come from the entries."
            />
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={frozen} onClick={() => setClassesOpen(true)}>
              <FormattedMessage
                id="entities.register.classes.new"
                defaultMessage="New share class"
              />
            </Button>
            <Button disabled={frozen || live.length === 0} onClick={() => setEntryDialog({})}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="entities.register.entry.title" defaultMessage="Record entry" />
            </Button>
          </div>
        </section>
      ) : (
        <>
          <RegisterOfMembers
            register={register}
            historic={historic}
            frozen={frozen}
            onClasses={() => setClassesOpen(true)}
          />
          <section className="overflow-hidden rounded-card border border-border-default bg-raised">
            <header className="flex h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4">
              <h2 className="text-base font-semibold">
                <FormattedMessage
                  id="entities.register.entries.title"
                  defaultMessage="Register of allotments and transfers"
                />
              </h2>
              <Button
                size="sm"
                disabled={frozen || live.length === 0}
                onClick={() => setEntryDialog({})}
              >
                <Plus size={16} aria-hidden="true" />
                <FormattedMessage
                  id="entities.register.entry.title"
                  defaultMessage="Record entry"
                />
              </Button>
            </header>
            <div className="flex flex-wrap items-center gap-3 border-b border-border-default px-4 py-2.5">
              <RecordFilterBar
                definitions={definitions}
                values={filters}
                busy={false}
                error={null}
                onChange={setFilters}
              />
              {historic ? (
                <span className="ms-auto text-xs text-muted">
                  <FormattedMessage
                    id="entities.register.entries.dimmed"
                    defaultMessage="Entries after {date} are dimmed"
                    values={{ date: formatDay(intl, register.asOf) }}
                  />
                </span>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="px-4 py-2 text-sm text-status-danger-fg">
                {error}
              </p>
            ) : null}
            <EntriesTable
              entries={shown}
              classNames={classNames}
              frozen={frozen}
              onEdit={(entry) => setEntryDialog({ entry })}
              onRemove={(entry) => void remove(entry)}
            />
          </section>
        </>
      )}
      <OwnershipCard
        entity={entity}
        candidates={candidates}
        initial={declaredHoldings}
        frozen={frozen}
        showOwners={false}
        showOwned
        ownersTitle={
          <FormattedMessage
            id="entities.register.declaredOwners"
            defaultMessage="Declared owners not in the register"
          />
        }
        ownedTitle={
          <FormattedMessage
            id="entities.register.ownedTitle"
            defaultMessage="Holdings in other Entities"
          />
        }
      />
      {classesOpen ? (
        <ShareClassesDialog
          entityId={entity.id}
          classes={register.classes}
          frozen={frozen}
          onOpenChange={setClassesOpen}
          onChanged={() => void revalidate()}
        />
      ) : null}
      {entryDialog ? (
        <ShareEntryDialog
          entityId={entity.id}
          register={register}
          entry={entryDialog.entry}
          candidates={candidates}
          onOpenChange={(open) => {
            if (!open) setEntryDialog(null);
          }}
          onSaved={() => {
            setEntryDialog(null);
            void revalidate();
          }}
        />
      ) : null}
    </div>
  );
}

/** DES-088's Register as of: prev, the date, next, Reset to today, and the timeline. */
function RegisterAsOf({
  register,
  onChange,
}: Readonly<{ register: ShareRegister; onChange: (next: string | null) => void }>) {
  const intl = useIntl();
  const ticks = [...new Set([...register.dates, register.today])].sort();
  const earlier = ticks.filter((date) => date < register.asOf);
  const later = ticks.filter((date) => date > register.asOf);
  const first = ticks[0] ?? register.today;
  const span = Math.max(1, Date.parse(register.today) - Date.parse(first));
  const position = (date: string) =>
    Math.min(100, Math.max(0, ((Date.parse(date) - Date.parse(first)) / span) * 100));
  // A label every 7% of the rail at most, so neighbouring ticks do not overlap.
  const labelled = new Set<string>();
  let lastLabelAt = -100;
  for (const date of ticks) {
    const at = position(date);
    if (at - lastLabelAt >= 7) {
      labelled.add(date);
      lastLabelAt = at;
    }
  }
  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">
          <FormattedMessage id="entities.register.asOf" defaultMessage="Register as of" />
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            disabled={earlier.length === 0}
            aria-label={intl.formatMessage({
              id: "entities.register.asOf.previous",
              defaultMessage: "Previous entry date",
            })}
            onClick={() => onChange(earlier.at(-1)!)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <DatePicker
            id="register-as-of"
            value={register.asOf}
            onChange={(next) => onChange(next || null)}
          />
          <Button
            variant="secondary"
            size="icon"
            disabled={later.length === 0}
            aria-label={intl.formatMessage({
              id: "entities.register.asOf.next",
              defaultMessage: "Next entry date",
            })}
            onClick={() => onChange(later[0]!)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={register.asOf === register.today}
            onClick={() => onChange(null)}
          >
            <FormattedMessage id="entities.register.asOf.reset" defaultMessage="Reset to today" />
          </Button>
        </div>
      </header>
      <div className="px-6 pb-4 pt-3">
        <div className="relative mx-2 h-11">
          <div className="absolute inset-x-0 top-5 h-0.5 bg-border-default">
            <div className="h-full bg-link" style={{ width: `${position(register.asOf)}%` }} />
          </div>
          {ticks.map((date) => {
            const at = position(date);
            const chosen = date === register.asOf;
            const showLabel = labelled.has(date);
            return (
              <button
                type="button"
                key={date}
                className="absolute top-0 -translate-x-1/2"
                style={{ left: `${at}%` }}
                aria-label={
                  date === register.today
                    ? intl.formatMessage({
                        id: "entities.register.asOf.today",
                        defaultMessage: "Today",
                      })
                    : formatDay(intl, date)
                }
                aria-current={chosen ? "date" : undefined}
                onClick={() => onChange(date === register.today ? null : date)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "block rounded-full border-2 bg-raised",
                    chosen
                      ? "mt-3 size-[18px] border-raised bg-accent ring-2 ring-accent"
                      : date <= register.asOf
                        ? "mt-3.5 size-3.5 border-link bg-link"
                        : "mt-3.5 size-3.5 border-border-strong",
                  )}
                />
                {showLabel ? (
                  <span
                    aria-hidden="true"
                    className="mt-1 block whitespace-nowrap text-xs text-muted"
                  >
                    {date === register.today
                      ? intl.formatMessage({
                          id: "entities.register.asOf.today",
                          defaultMessage: "Today",
                        })
                      : formatMonth(intl, date)}
                  </span>
                ) : null}
              </button>
            );
          })}
          {!ticks.includes(register.asOf) ? (
            <span
              aria-hidden="true"
              className="absolute top-3 size-[18px] -translate-x-1/2 rounded-full border-2 border-raised bg-accent ring-2 ring-accent"
              style={{ left: `${position(register.asOf)}%` }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ReconciliationNote({ register }: Readonly<{ register: ShareRegister }>) {
  const intl = useIntl();
  const { declaredIssued, registerIssued } = register.reconciliation;
  const agrees = declaredIssued === null || declaredIssued === registerIssued;
  const issuedAt = register.totals
    .filter((total) => total.issued > 0)
    .map(
      (total) =>
        `${intl.formatNumber(total.issued)} ${register.classes.find((row) => row.id === total.shareClassId)?.name ?? ""}`,
    )
    .join(" · ");
  return (
    <p
      role={agrees ? undefined : "alert"}
      className={cn(
        "rounded-card border px-3 py-2 text-sm",
        agrees
          ? "border-status-success-fg bg-status-success-bg text-status-success-fg"
          : "border-status-warning-fg bg-status-warning-bg text-status-warning-fg",
      )}
    >
      {register.asOf !== register.today ? (
        <FormattedMessage
          id="entities.register.reconciliation.historic"
          defaultMessage="At {date} the register showed {issued} issued, from {applied, plural, one {# entry} other {# entries}} of {total}. "
          values={{
            date: formatDay(intl, register.asOf),
            issued: issuedAt || intl.formatNumber(0),
            applied: register.entries.filter((entry) => entry.applied).length,
            total: register.entries.length,
          }}
        />
      ) : null}
      {agrees ? (
        <FormattedMessage
          id="entities.register.reconciliation.agrees"
          defaultMessage="Today the register agrees with Share capital: {issued} issued."
          values={{ issued: intl.formatNumber(registerIssued) }}
        />
      ) : (
        <FormattedMessage
          id="entities.register.reconciliation.differs"
          defaultMessage="Today the register does not agree with Share capital. The Overview declares {declared} issued; the register sums to {issued}."
          values={{
            declared: intl.formatNumber(declaredIssued ?? 0),
            issued: intl.formatNumber(registerIssued),
          }}
        />
      )}
    </p>
  );
}

function Header({
  children,
  align = "start",
}: Readonly<{ children: ReactNode; align?: "start" | "end" }>) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-2 font-medium", align === "end" ? "text-end" : "text-start")}
    >
      {children}
    </th>
  );
}

function HolderCell({ row }: Readonly<{ row: RegisterRow }>) {
  const intl = useIntl();
  if (row.holder.restricted) return <RestrictedRecordCell label={RESTRICTED} />;
  const initials = row.holder.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center text-xs font-semibold",
          row.holder.kind === "entity"
            ? "rounded-button bg-badge-count-bg text-badge-count-fg"
            : "rounded-avatar bg-avatar-bg text-avatar-fg",
        )}
      >
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium">{row.holder.name}</p>
        <p className="text-xs text-muted">
          {row.holder.kind === "entity"
            ? [
                intl.formatMessage({
                  id: "entities.register.holder.entity",
                  defaultMessage: "Entity",
                }),
                row.holder.jurisdiction,
              ]
                .filter(Boolean)
                .join(" · ")
            : intl.formatMessage({
                id: "entities.ownership.individual",
                defaultMessage: "Individual",
              })}
        </p>
      </div>
    </div>
  );
}

function RegisterOfMembers({
  register,
  historic,
  frozen,
  onClasses,
}: Readonly<{
  register: ShareRegister;
  historic: boolean;
  frozen: boolean;
  onClasses: () => void;
}>) {
  const intl = useIntl();
  const holders = new Set(
    register.holders.map((row) => (row.holder.restricted ? `r:${row.holder.id}` : row.holder.id)),
  );
  const applied = register.entries.filter((entry) => entry.applied).length;
  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">
          {historic ? (
            <FormattedMessage
              id="entities.register.members.titleAt"
              defaultMessage="Register of members at {date}"
              values={{ date: formatDay(intl, register.asOf) }}
            />
          ) : (
            <FormattedMessage
              id="entities.register.members.title"
              defaultMessage="Register of members"
            />
          )}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            <FormattedMessage
              id="entities.register.members.meta"
              defaultMessage="{holders, plural, one {# holder} other {# holders}} · {classes, plural, one {# class} other {# classes}} · derived from {entries, plural, one {# register entry} other {# register entries}}"
              values={{
                holders: holders.size,
                classes: register.classes.filter((row) => row.archivedAt === null).length,
                entries: applied,
              }}
            />
          </span>
          <Button variant="secondary" size="sm" disabled={frozen} onClick={onClasses}>
            <FormattedMessage id="entities.register.classes.title" defaultMessage="Share classes" />
          </Button>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-raised text-xs text-muted">
              <Header>
                {intl.formatMessage({ id: "entities.register.holder", defaultMessage: "Holder" })}
              </Header>
              <Header>
                {intl.formatMessage({
                  id: "entities.register.entry.class",
                  defaultMessage: "Class",
                })}
              </Header>
              <Header align="end">
                {intl.formatMessage({
                  id: "entities.register.entry.shares",
                  defaultMessage: "Shares",
                })}
              </Header>
              <Header align="end">
                {intl.formatMessage({
                  id: "entities.register.members.ofClass",
                  defaultMessage: "% of class",
                })}
              </Header>
              <Header align="end">
                {intl.formatMessage({
                  id: "entities.register.members.voting",
                  defaultMessage: "% voting",
                })}
              </Header>
              <Header>
                {intl.formatMessage({
                  id: "entities.register.entry.certificates",
                  defaultMessage: "Certificates",
                })}
              </Header>
              <Header>
                {intl.formatMessage({
                  id: "entities.register.members.since",
                  defaultMessage: "Member since",
                })}
              </Header>
              {historic ? (
                <Header align="end">
                  {intl.formatMessage({
                    id: "entities.register.members.change",
                    defaultMessage: "Change to today",
                  })}
                </Header>
              ) : null}
            </tr>
          </thead>
          {register.classes
            .filter((shareClass) =>
              register.totals.some(
                (total) => total.shareClassId === shareClass.id && total.issued > 0,
              ),
            )
            .map((shareClass) => {
              const total = register.totals.find((row) => row.shareClassId === shareClass.id)!;
              const rows = register.holders.filter((row) => row.shareClassId === shareClass.id);
              const treasury = register.treasury.find((row) => row.shareClassId === shareClass.id);
              return (
                <tbody key={shareClass.id} className="border-t border-border-default">
                  {rows.map((row) => (
                    <tr
                      key={`${row.holder.id}:${row.shareClassId}`}
                      className="border-b border-border-muted last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <HolderCell row={row} />
                      </td>
                      <td className="px-3 py-2">{shareClass.name}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {intl.formatNumber(row.balance)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {percent(intl, row.percentOfClass)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {percent(intl, row.percentOfVotes)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.certificates.join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.memberSince ? formatDay(intl, row.memberSince) : "—"}
                      </td>
                      {historic ? <ChangeCell from={row.balance} to={row.balanceToday} /> : null}
                    </tr>
                  ))}
                  {treasury ? (
                    <tr className="border-b border-border-muted">
                      <td className="px-3 py-2">
                        <p className="font-medium">
                          <FormattedMessage
                            id="entities.register.treasury"
                            defaultMessage="Treasury"
                          />
                        </p>
                        <p className="text-xs text-muted">
                          <FormattedMessage
                            id="entities.register.treasuryHint"
                            defaultMessage="Held by the company"
                          />
                        </p>
                      </td>
                      <td className="px-3 py-2">{shareClass.name}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {intl.formatNumber(treasury.balance)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {percent(
                          intl,
                          total.issued > 0 ? (treasury.balance / total.issued) * 100 : 0,
                        )}
                      </td>
                      <td className="px-3 py-2 text-end text-muted">—</td>
                      <td className="px-3 py-2 text-muted">—</td>
                      <td className="px-3 py-2 text-muted">—</td>
                      {historic ? <td className="px-3 py-2" /> : null}
                    </tr>
                  ) : null}
                  <tr className="bg-section-header font-semibold">
                    <td className="px-3 py-2" colSpan={2}>
                      <FormattedMessage
                        id="entities.register.members.total"
                        defaultMessage="Total {className}"
                        values={{ className: shareClass.name }}
                      />
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {intl.formatNumber(total.issued)}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{percent(intl, 100)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {percent(intl, total.percentOfVotes)}
                    </td>
                    <td
                      className="px-3 py-2 text-xs font-normal text-muted"
                      colSpan={historic ? 3 : 2}
                    >
                      <FormattedMessage
                        id="entities.register.members.classSummary"
                        defaultMessage="{outstanding} outstanding · {treasury} in treasury{hasPar, select, yes { · par {par}} other {}}{hasRights, select, yes { · {rights}} other {}}"
                        values={{
                          outstanding: intl.formatNumber(total.outstanding),
                          treasury: intl.formatNumber(total.treasury),
                          hasPar:
                            shareClass.parValue !== null && shareClass.parValueCurrency
                              ? "yes"
                              : "no",
                          par:
                            shareClass.parValue !== null && shareClass.parValueCurrency
                              ? intl.formatNumber(
                                  toMajorUnits(shareClass.parValue, shareClass.parValueCurrency),
                                  { style: "currency", currency: shareClass.parValueCurrency },
                                )
                              : "",
                          hasRights: shareClass.rights ? "yes" : "no",
                          rights: shareClass.rights ?? "",
                        }}
                      />
                    </td>
                  </tr>
                </tbody>
              );
            })}
        </table>
      </div>
    </section>
  );
}

function ChangeCell({ from, to }: Readonly<{ from: number; to: number }>) {
  const intl = useIntl();
  const delta = to - from;
  return (
    <td
      className={cn(
        "px-3 py-2 text-end text-xs tabular-nums",
        delta > 0 ? "text-status-success-fg" : delta < 0 ? "text-status-danger-fg" : "text-muted",
      )}
    >
      {delta === 0 ? "—" : `${delta > 0 ? "+" : "−"}${intl.formatNumber(Math.abs(delta))}`}
    </td>
  );
}

function EntriesTable({
  entries,
  classNames,
  frozen,
  onEdit,
  onRemove,
}: Readonly<{
  entries: RegisterEntry[];
  classNames: Map<string, string>;
  frozen: boolean;
  onEdit: (entry: RegisterEntry) => void;
  onRemove: (entry: RegisterEntry) => void;
}>) {
  const intl = useIntl();
  if (entries.length === 0) {
    return (
      <p className="p-4 text-sm text-muted">
        <FormattedMessage
          id="entities.register.entries.none"
          defaultMessage="No entries match these filters."
        />
      </p>
    );
  }
  const holder = (ref: RegisterEntry["from"]) =>
    ref?.restricted ? <RestrictedRecordCell label={RESTRICTED} /> : holderLabel(intl, ref);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <Header>#</Header>
            <Header>
              {intl.formatMessage({ id: "entities.register.entry.date", defaultMessage: "Date" })}
            </Header>
            <Header>
              {intl.formatMessage({ id: "entities.register.entry.kind", defaultMessage: "Entry" })}
            </Header>
            <Header>
              {intl.formatMessage({ id: "entities.register.entry.from", defaultMessage: "From" })}
            </Header>
            <Header>
              {intl.formatMessage({ id: "entities.register.entry.to", defaultMessage: "To" })}
            </Header>
            <Header>
              {intl.formatMessage({ id: "entities.register.entry.class", defaultMessage: "Class" })}
            </Header>
            <Header align="end">
              {intl.formatMessage({
                id: "entities.register.entry.shares",
                defaultMessage: "Shares",
              })}
            </Header>
            <Header>
              {intl.formatMessage({
                id: "entities.register.entry.distinctiveShort2",
                defaultMessage: "Distinctive nos.",
              })}
            </Header>
            <Header>
              {intl.formatMessage({
                id: "entities.register.entry.consideration",
                defaultMessage: "Consideration",
              })}
            </Header>
            <Header>
              {intl.formatMessage({
                id: "entities.register.entry.certIssued",
                defaultMessage: "Cert. issued",
              })}
            </Header>
            <Header>
              {intl.formatMessage({
                id: "entities.register.entry.certCancelled",
                defaultMessage: "Cert. cancelled",
              })}
            </Header>
            <Header>
              {intl.formatMessage({
                id: "entities.register.entry.resolutionShort",
                defaultMessage: "Resolution",
              })}
            </Header>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">
                <FormattedMessage
                  id="entities.record.obligations.actions"
                  defaultMessage="Actions"
                />
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="border-t border-border-default">
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className={cn(
                "border-b border-border-muted last:border-b-0",
                !entry.applied && "opacity-45",
              )}
              data-applied={entry.applied ? "true" : "false"}
            >
              <td className="px-3 py-2 text-muted">{String(entry.entryNo).padStart(3, "0")}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDay(intl, entry.effectiveOn)}</td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    "rounded-pill px-2 py-0.5 text-xs font-medium",
                    entryKindPillClass(entry.kind),
                  )}
                >
                  {entryKindLabel(intl, entry.kind)}
                </span>
              </td>
              <td className="px-3 py-2">{holder(entry.from)}</td>
              <td className="px-3 py-2">
                {entry.kind === "conversion" ? holder(entry.from) : holder(entry.to)}
              </td>
              <td className="px-3 py-2">
                {classNames.get(entry.shareClassId) ?? ""}
                {entry.toShareClassId ? ` → ${classNames.get(entry.toShareClassId) ?? ""}` : ""}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                {intl.formatNumber(entry.quantity)}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{entry.distinctiveNumbers ?? "—"}</td>
              <td className="px-3 py-2">
                {entry.consideration ??
                  (entry.pricePerShare !== null && entry.priceCurrency
                    ? intl.formatNumber(toMajorUnits(entry.pricePerShare, entry.priceCurrency), {
                        style: "currency",
                        currency: entry.priceCurrency,
                      })
                    : "—")}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {entry.certificatesIssued.map((certificate) => certificate.number).join(", ") ||
                  "—"}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {entry.certificatesCancelled.join(", ") || "—"}
              </td>
              <td className="px-3 py-2">{entry.resolutionRef ?? "—"}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={frozen}
                    aria-label={intl.formatMessage(
                      { id: "entities.register.entry.edit", defaultMessage: "Edit entry {number}" },
                      { number: entry.entryNo },
                    )}
                    onClick={() => onEdit(entry)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={frozen}
                    aria-label={intl.formatMessage(
                      {
                        id: "entities.register.entry.remove",
                        defaultMessage: "Remove entry {number}",
                      },
                      { number: entry.entryNo },
                    )}
                    onClick={() => onRemove(entry)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
