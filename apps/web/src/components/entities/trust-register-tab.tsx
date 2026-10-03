// SPDX-License-Identifier: AGPL-3.0-only

/** DES-096: dated trust parties, the fund ledger, entries and owned Holdings. */

import { useId, useState, type ReactNode } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityHoldings, EntityRow } from "../../lib/entities";
import { currencyFractionDigits, toMajorUnits } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  TRUST_KINDS,
  TRUST_ROLES,
  groupMessages,
  kindMessages,
  kindPills,
  roleMessages,
  knownParties,
  partyLabel,
  entryRole,
  type TrustRegister,
  type TrustEntry,
} from "../../lib/trust-register";
import { cn } from "../../lib/utils";
import { RegisterPartyCell } from "./register-party-cell";
import { RecordFilterBar, type RecordFilter } from "../table/record-filter-bar";
import { Button } from "../ui/button";
import { OwnedHoldingsCard } from "./owned-holdings-card";
import { RegisterAsOf, RemoveEntryDialog } from "./share-register-tab";
import { TrustEntryDialog } from "./trust-entry-dialog";

const FILTER_KEYS = ["kind", "role", "party", "effectiveFrom", "effectiveTo"] as const;
const none = <FormattedMessage id="entities.list.value.none" defaultMessage="—" />;
function Header({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <th scope="col" className="px-3 py-2 text-start font-medium">
      {children}
    </th>
  );
}
function ExportLink({
  entityId,
  kind,
  asOf,
  children,
}: Readonly<{
  entityId: string;
  kind: "parties" | "entries";
  asOf?: string;
  children: ReactNode;
}>) {
  const params = new URLSearchParams({ kind });
  if (asOf) params.set("asOf", asOf);
  return (
    <a
      className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
      href={`/api/v1/entities/${entityId}/trust-register/export?${params.toString()}`}
      download
    >
      <Download size={14} aria-hidden="true" />
      {children}
    </a>
  );
}
export function TrustRegisterTab({
  entity,
  register,
  holdings,
  candidates,
  users,
  frozen,
}: Readonly<{
  entity: EntityRow;
  register: TrustRegister;
  holdings: EntityHoldings;
  candidates: EntityRow[];
  users: import("../../lib/entities").EntityPersonOption[];
  frozen: boolean;
}>) {
  const intl = useIntl();
  const [params, setParams] = useSearchParams();
  const { revalidate } = useRevalidator();
  const partiesHeading = useId();
  const entriesHeading = useId();
  const [dialog, setDialog] = useState<{ entry?: TrustEntry } | null>(null);
  const [removing, setRemoving] = useState<TrustEntry | null>(null);
  const historic = register.asOf !== register.today;
  const empty = register.entries.length === 0;
  const day = (value: string) =>
    intl.formatDate(new Date(`${value}T12:00:00Z`), {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const money = (value: number, currency: string) =>
    intl.formatNumber(toMajorUnits(value, currency), {
      maximumFractionDigits: currencyFractionDigits(currency),
    });
  const filters: Record<string, string | boolean> = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  const definitions: RecordFilter[] = [
    {
      key: "kind",
      label: intl.formatMessage({ id: "entities.register.entry.kind", defaultMessage: "Entry" }),
      kind: "choices",
      choices: TRUST_KINDS.map((k) => ({
        id: k,
        displayName: intl.formatMessage(kindMessages[k]),
      })),
    },
    {
      key: "role",
      label: intl.formatMessage({ id: "entities.trust.role", defaultMessage: "Role" }),
      kind: "choices",
      choices: TRUST_ROLES.map((r) => ({
        id: r,
        displayName: intl.formatMessage(roleMessages[r]),
      })),
    },
    {
      key: "party",
      label: intl.formatMessage({ id: "entities.trust.party", defaultMessage: "Party" }),
      kind: "choices",
      choices: knownParties(register).map((p) => ({ id: p.id, displayName: partyLabel(intl, p) })),
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
  const matches = (key: string, value: string) =>
    !filters[key] || String(filters[key]).split(",").includes(value);
  const shown = register.entries.filter(
    (e) =>
      matches("kind", e.kind) &&
      matches("role", entryRole(e)) &&
      matches("party", e.party.id) &&
      (!filters.effectiveFrom || e.effectiveOn >= String(filters.effectiveFrom)) &&
      (!filters.effectiveTo || e.effectiveOn <= String(filters.effectiveTo)),
  );
  // Closed intervals stay in historic views; today's register lists current roles.
  const rows = register.parties.filter((r) => historic || r.open);
  async function remove(entry: TrustEntry) {
    const result = await api
      .DELETE("/api/v1/entities/{id}/trust-entries/{entryId}", {
        params: { path: { id: entity.id, entryId: entry.id } },
      })
      .catch(() => undefined);
    if (!result?.response.ok)
      return (
        (await problem(result)).detail ??
        intl.formatMessage({
          id: "entities.register.entry.removeError",
          defaultMessage: "The entry could not be removed.",
        })
      );
    setRemoving(null);
    void revalidate();
    return null;
  }
  const recordButton = (
    <Button size="sm" disabled={frozen} onClick={() => setDialog({})}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="entities.register.entry.title" defaultMessage="Record entry" />
    </Button>
  );
  return (
    <section
      className="flex flex-col gap-4"
      aria-label={intl.formatMessage({
        id: "entities.registerKind.trust",
        defaultMessage: "Trust register",
      })}
    >
      {empty ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-14 text-center">
          <h2 className="text-md font-semibold">
            <FormattedMessage id="entities.trust.empty" defaultMessage="No trust register yet" />
          </h2>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="entities.trust.emptyHint"
              defaultMessage="Record the first entry. Trust parties come from the entries."
            />
          </p>
          {recordButton}
        </section>
      ) : (
        <>
          <RegisterAsOf
            register={register}
            minDate={entity.formedOn ?? undefined}
            onChange={(next) => {
              const search = new URLSearchParams(params);
              if (next && next !== register.today) search.set("asOf", next);
              else search.delete("asOf");
              setParams(search);
            }}
          />
          <div className="rounded-card border border-border-default bg-raised px-4 py-3 text-sm">
            {register.fund.length ? (
              register.fund.map((f) => (
                <p key={f.currency}>
                  <FormattedMessage
                    id="entities.trust.fund"
                    defaultMessage="Settled {settled} {currency} · Distributed {distributed} {currency} · Fund {balance} {currency}"
                    values={{
                      settled: money(f.settled, f.currency),
                      distributed: money(f.distributed, f.currency),
                      balance: money(f.balance, f.currency),
                      currency: f.currency,
                    }}
                  />
                </p>
              ))
            ) : (
              <p>
                <FormattedMessage
                  id="entities.trust.noMoney"
                  defaultMessage="No money settlements or distributions recorded at this date."
                />
              </p>
            )}
            {register.warnings.map((w) => (
              <p
                key={w.currency}
                role="alert"
                className="mt-2 rounded-card bg-status-warning-bg px-3 py-2 text-status-warning-fg"
              >
                <FormattedMessage
                  id="entities.trust.fundNegative"
                  defaultMessage="Distributions exceed settlements in {currency}."
                  values={{ currency: w.currency }}
                />
              </p>
            ))}
          </div>
          <section
            className="overflow-hidden rounded-card border border-border-default bg-raised"
            aria-labelledby={partiesHeading}
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-3">
              <h2 id={partiesHeading} className="text-base font-semibold">
                {historic ? (
                  <FormattedMessage
                    id="entities.trust.partiesAt"
                    defaultMessage="Register of trust parties at {date}"
                    values={{ date: day(register.asOf) }}
                  />
                ) : (
                  <FormattedMessage
                    id="entities.trust.parties"
                    defaultMessage="Register of trust parties"
                  />
                )}
              </h2>
              <ExportLink entityId={entity.id} kind="parties" asOf={register.asOf}>
                <FormattedMessage
                  id="entities.register.members.export"
                  defaultMessage="Export register"
                />
              </ExportLink>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-200 text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <Header>
                      <FormattedMessage id="entities.trust.party" defaultMessage="Party" />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.trust.roleDetail"
                        defaultMessage="Role detail"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage id="entities.trust.since" defaultMessage="Since" />
                    </Header>
                    {historic ? (
                      <Header>
                        <FormattedMessage id="entities.trust.until" defaultMessage="Until" />
                      </Header>
                    ) : null}
                    <Header>
                      <FormattedMessage id="entities.trust.reference" defaultMessage="Reference" />
                    </Header>
                    {historic ? (
                      <Header>
                        <FormattedMessage
                          id="entities.register.members.change"
                          defaultMessage="Change to today"
                        />
                      </Header>
                    ) : null}
                  </tr>
                </thead>
                {TRUST_ROLES.map((role) => {
                  const group = rows.filter((r) => r.role === role);
                  return group.length ? (
                    <tbody key={role}>
                      <tr className="bg-section-header">
                        <th
                          scope="rowgroup"
                          colSpan={historic ? 6 : 4}
                          className="px-3 py-2 text-start font-semibold"
                        >
                          {intl.formatMessage(groupMessages[role])}
                        </th>
                      </tr>
                      {group.map((r, i) => {
                        const origin = register.entries.find(
                          (e) =>
                            e.party.id === r.party.id &&
                            e.effectiveOn === r.since &&
                            entryRole(e) === r.role &&
                            e.roleLabel === r.roleLabel &&
                            (e.kind === "appointment" || e.kind === "settlement"),
                        );
                        const todayInterval = register.partiesToday.find(
                          (n) =>
                            n.party.id === r.party.id &&
                            n.role === r.role &&
                            n.roleLabel === r.roleLabel,
                        );
                        return (
                          <tr
                            key={`${r.party.id}:${r.since}:${i}`}
                            className="border-b border-border-muted last:border-b-0"
                          >
                            <td className="px-3 py-2">
                              <RegisterPartyCell party={r.party} candidates={candidates} />
                            </td>
                            <td className="px-3 py-2">
                              {(r.role === "other" ? r.roleLabel : r.interest) || none}
                            </td>
                            <td className="px-3 py-2">{day(r.since)}</td>
                            {historic ? (
                              <td className="px-3 py-2">{r.until ? day(r.until) : none}</td>
                            ) : null}
                            <td className="px-3 py-2">{origin?.reference || none}</td>
                            {historic ? (
                              <td className="px-3 py-2">
                                {r.open && !r.openToday ? (
                                  <FormattedMessage
                                    id="entities.trust.ceased"
                                    defaultMessage="Ceased"
                                  />
                                ) : todayInterval && todayInterval.since !== r.since ? (
                                  <FormattedMessage
                                    id="entities.trust.reappointed"
                                    defaultMessage="Reappointed {date}"
                                    values={{ date: day(todayInterval.since) }}
                                  />
                                ) : !r.open && r.openToday ? (
                                  <FormattedMessage
                                    id="entities.trust.appointed"
                                    defaultMessage="Appointed"
                                  />
                                ) : (
                                  none
                                )}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  ) : null;
                })}
              </table>
            </div>
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                <FormattedMessage
                  id="entities.trust.noParties"
                  defaultMessage="No trust parties at this date."
                />
              </p>
            ) : null}
          </section>
          <section
            className="overflow-hidden rounded-card border border-border-default bg-raised"
            aria-labelledby={entriesHeading}
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-3">
              <h2 id={entriesHeading} className="text-base font-semibold">
                <FormattedMessage
                  id="entities.trust.entries"
                  defaultMessage="Register of trust entries"
                />
              </h2>
              <div className="flex items-center gap-3">
                <ExportLink entityId={entity.id} kind="entries">
                  <FormattedMessage id="entities.register.export" defaultMessage="Export" />
                </ExportLink>
                {recordButton}
              </div>
            </header>
            <div className="flex flex-wrap items-center gap-3 border-b border-border-default px-4 py-2.5">
              <RecordFilterBar
                definitions={definitions}
                values={filters}
                busy={false}
                error={null}
                onChange={(next) => {
                  const search = new URLSearchParams(params);
                  for (const key of FILTER_KEYS) {
                    search.delete(key);
                    if (typeof next[key] === "string" && next[key]) search.set(key, next[key]);
                  }
                  setParams(search);
                }}
              />
              {historic ? (
                <span className="ms-auto text-xs text-muted">
                  <FormattedMessage
                    id="entities.register.entries.dimmed"
                    defaultMessage="Entries after {date} are dimmed"
                    values={{ date: day(register.asOf) }}
                  />
                </span>
              ) : null}
            </div>
            {shown.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-250 text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <Header>
                        <FormattedMessage id="entities.trust.number" defaultMessage="#" />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.register.entry.date" defaultMessage="Date" />
                      </Header>
                      <Header>
                        <FormattedMessage
                          id="entities.register.entry.kind"
                          defaultMessage="Entry"
                        />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.trust.party" defaultMessage="Party" />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.trust.role" defaultMessage="Role" />
                      </Header>
                      <Header>
                        <FormattedMessage
                          id="entities.trust.amountOrProperty"
                          defaultMessage="Amount or property"
                        />
                      </Header>
                      <Header>
                        <FormattedMessage
                          id="entities.trust.reference"
                          defaultMessage="Reference"
                        />
                      </Header>
                      <Header>
                        <span className="sr-only">
                          <FormattedMessage
                            id="entities.record.obligations.actions"
                            defaultMessage="Actions"
                          />
                        </span>
                      </Header>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr
                        key={e.id}
                        data-applied={e.applied ? "true" : "false"}
                        className={cn(
                          "border-b border-border-muted last:border-b-0",
                          !e.applied && "bg-section-header text-muted",
                        )}
                      >
                        <td className="px-3 py-2 font-mono">
                          {String(e.entryNo).padStart(3, "0")}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{day(e.effectiveOn)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-pill px-2 py-0.5 text-xs font-medium",
                              kindPills[e.kind],
                            )}
                          >
                            {intl.formatMessage(kindMessages[e.kind])}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <RegisterPartyCell party={e.party} candidates={candidates} />
                        </td>
                        <td className="px-3 py-2">
                          {e.roleLabel || intl.formatMessage(roleMessages[entryRole(e)])}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {e.amount !== null && e.currency ? (
                            <FormattedMessage
                              id="entities.trust.moneyValue"
                              defaultMessage="{amount} {currency}"
                              values={{ amount: money(e.amount, e.currency), currency: e.currency }}
                            />
                          ) : (
                            e.property || none
                          )}
                        </td>
                        <td className="px-3 py-2">{e.reference || none}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={frozen}
                              aria-label={intl.formatMessage(
                                {
                                  id: "entities.register.entry.edit",
                                  defaultMessage: "Edit entry {number}",
                                },
                                { number: e.entryNo },
                              )}
                              onClick={() => setDialog({ entry: e })}
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
                                { number: e.entryNo },
                              )}
                              onClick={() => setRemoving(e)}
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
            ) : (
              <p className="p-4 text-sm text-muted">
                <FormattedMessage
                  id="entities.register.entries.none"
                  defaultMessage="No entries match these filters."
                />
              </p>
            )}
          </section>
        </>
      )}
      <OwnedHoldingsCard rows={holdings.owned} />
      {dialog ? (
        <TrustEntryDialog
          entityId={entity.id}
          register={register}
          entry={dialog.entry}
          candidates={candidates}
          users={users}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void revalidate();
          }}
        />
      ) : null}
      {removing ? (
        <RemoveEntryDialog
          entry={removing}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        />
      ) : null}
    </section>
  );
}
