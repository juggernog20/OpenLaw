// SPDX-License-Identifier: AGPL-3.0-only

/** DES-095: partners and capital read as of a date, followed by entries and owned Holdings. */

import { useId, useState, type ReactNode } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityHoldings, EntityRow } from "../../lib/entities";
import { formatCount, formatCurrency, formatFullDate, formatPercent } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  PARTNERSHIP_KINDS,
  kindMessages,
  kindPills,
  capacityMessages,
  basisNotes,
  knownParties,
  type PartnershipRegister,
  type PartnershipEntry,
} from "../../lib/partnership-register";
import { partyLabel } from "../../lib/trust-register";
import { cn } from "../../lib/utils";
import { RecordFilterBar, type RecordFilter } from "../table/record-filter-bar";
import { Button } from "../ui/button";
import { OwnedHoldingsCard } from "./owned-holdings-card";
import { RegisterAsOf, RemoveEntryDialog } from "./share-register-tab";
import { RegisterPartyCell } from "./register-party-cell";
import { PartnershipEntryDialog } from "./partnership-entry-dialog";
import { PartnershipBasisDialog } from "./partnership-basis-dialog";

const FILTER_KEYS = ["kind", "party", "effectiveFrom", "effectiveTo"] as const;
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
  kind: "partners" | "entries";
  asOf?: string;
  children: ReactNode;
}>) {
  const params = new URLSearchParams({ kind });
  if (asOf) params.set("asOf", asOf);
  return (
    <a
      className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
      href={`/api/v1/entities/${entityId}/partnership-register/export?${params.toString()}`}
      download
    >
      <Download size={14} aria-hidden="true" />
      {children}
    </a>
  );
}
function CapacityPill({
  capacity,
  status,
}: Readonly<{
  capacity: PartnershipEntry["capacity"];
  status?: "admitted" | "assignee" | "ceased" | null;
}>) {
  const intl = useIntl();
  const label = status === "assignee" || status === "ceased" ? status : capacity;
  if (!label) return none;
  return (
    <span
      className={cn(
        "rounded-pill px-2 py-0.5 text-xs font-medium",
        label === "general"
          ? "bg-status-assigned-bg text-status-assigned-fg"
          : label === "limited"
            ? "bg-status-neutral-bg text-status-neutral-fg"
            : "bg-section-header text-muted",
      )}
    >
      {intl.formatMessage(capacityMessages[label])}
    </span>
  );
}

const changeColor = (delta: number) =>
  delta > 0 ? "text-status-success-fg" : "text-status-danger-fg";

function BalanceChange({
  units,
  capital,
  currency,
}: Readonly<{ units: number; capital: number; currency: string | null }>) {
  const intl = useIntl();
  return (
    <>
      {units ? (
        <span
          className={changeColor(units)}
          title={intl.formatMessage({ id: "entities.partnership.units", defaultMessage: "Units" })}
        >
          {intl.formatNumber(units, { signDisplay: "always" })}
        </span>
      ) : null}
      {capital && currency ? (
        <span
          className={changeColor(capital)}
          title={intl.formatMessage({
            id: "entities.partnership.unreturned",
            defaultMessage: "Unreturned",
          })}
        >
          {capital > 0 ? (
            <FormattedMessage
              id="entities.partnership.capitalIncrease"
              defaultMessage="+{amount}"
              values={{
                amount: formatCurrency({ amount: capital, currency }, { locale: intl.locale }),
              }}
            />
          ) : (
            formatCurrency({ amount: capital, currency }, { locale: intl.locale })
          )}
        </span>
      ) : null}
    </>
  );
}

function PartnerChange({
  partner,
  today,
  currency,
}: Readonly<{
  partner: PartnershipRegister["partners"][number];
  today?: PartnershipRegister["partners"][number];
  currency: string | null;
}>) {
  const intl = useIntl();
  const units = (today?.units ?? 0) - partner.units;
  const capital = (today?.unreturned ?? 0) - partner.unreturned;
  const percent = (today?.percent ?? 0) - partner.percent;
  const statusChanged =
    today && (today.status !== partner.status || today.capacity !== partner.capacity);
  return (
    <div className="flex flex-col gap-1 text-end font-mono">
      <BalanceChange units={units} capital={capital} currency={currency} />
      {percent ? (
        <span className={changeColor(percent)}>
          <FormattedMessage
            id="entities.partnership.percentChange"
            defaultMessage="{change} pp"
            values={{
              change: intl.formatNumber(percent, {
                signDisplay: "always",
                maximumFractionDigits: 2,
              }),
            }}
          />
        </span>
      ) : null}
      {statusChanged ? <CapacityPill capacity={today.capacity} status={today.status} /> : null}
      {!units && !capital && !percent && !statusChanged ? none : null}
    </div>
  );
}

export function PartnershipRegisterTab({
  entity,
  register,
  holdings,
  candidates,
  frozen,
}: Readonly<{
  entity: EntityRow;
  register: PartnershipRegister;
  holdings: EntityHoldings;
  candidates: EntityRow[];
  frozen: boolean;
}>) {
  const intl = useIntl();
  const [params, setParams] = useSearchParams();
  const { revalidate } = useRevalidator();
  const partnersHeading = useId(),
    entriesHeading = useId();
  const [dialog, setDialog] = useState<{ entry?: PartnershipEntry } | null>(null);
  const [removing, setRemoving] = useState<PartnershipEntry | null>(null);
  const [basisOpen, setBasisOpen] = useState(false);
  const historic = register.asOf !== register.today;
  const capitalCurrency =
    register.currency ?? register.entries.find((e) => e.currency)?.currency ?? null;
  const day = (value: string) => formatFullDate(value, { locale: intl.locale });
  const count = (value: number) => formatCount(value, { locale: intl.locale });
  const percent = (value: number) =>
    formatPercent(value / 100, { locale: intl.locale, maximumFractionDigits: 2 });
  const money = (value: number, currency = register.currency) =>
    currency ? formatCurrency({ amount: value, currency }, { locale: intl.locale }) : none;
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
      choices: PARTNERSHIP_KINDS.map((k) => ({
        id: k,
        displayName: intl.formatMessage(kindMessages[k]),
      })),
    },
    {
      key: "party",
      label: intl.formatMessage({ id: "entities.partnership.partner", defaultMessage: "Partner" }),
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
      [e.party, e.fromParty, e.toParty].some((p) => p && matches("party", p.id)) &&
      (!filters.effectiveFrom || e.effectiveOn >= String(filters.effectiveFrom)) &&
      (!filters.effectiveTo || e.effectiveOn <= String(filters.effectiveTo)),
  );
  async function remove(entry: PartnershipEntry) {
    const result = await api
      .DELETE("/api/v1/entities/{id}/partnership-entries/{entryId}", {
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
        id: "entities.registerKind.partnership",
        defaultMessage: "Partnership register",
      })}
    >
      {register.entries.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-14 text-center">
          <h2 className="text-md font-semibold">
            <FormattedMessage
              id="entities.partnership.empty"
              defaultMessage="No partnership register yet"
            />
          </h2>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="entities.partnership.emptyHint"
              defaultMessage="Record the first entry. Partners come from the entries."
            />
          </p>
          {recordButton}
        </section>
      ) : (
        <>
          <RegisterAsOf
            register={register}
            onChange={(next) => {
              const search = new URLSearchParams(params);
              if (next && next !== register.today) search.set("asOf", next);
              else search.delete("asOf");
              setParams(search);
            }}
          />
          <div className="rounded-card border border-border-default bg-raised px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                {register.currency ? (
                  <FormattedMessage
                    id="entities.partnership.basisCurrency"
                    defaultMessage="{basis} · {currency}"
                    values={{
                      basis: intl.formatMessage(basisNotes[register.basis]),
                      currency: register.currency,
                    }}
                  />
                ) : (
                  intl.formatMessage(basisNotes[register.basis])
                )}
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={frozen}
                onClick={() => setBasisOpen(true)}
              >
                <FormattedMessage
                  id="entities.partnership.changeBasis"
                  defaultMessage="Change basis"
                />
              </Button>
            </div>
            {register.warnings.map((w) => (
              <p
                key={w.code}
                role="alert"
                className="mt-2 rounded-card bg-status-warning-bg px-3 py-2 text-status-warning-fg"
              >
                <FormattedMessage
                  id="entities.partnership.statedTotal"
                  defaultMessage="Today's stated percentages total {total}, not 100%. Check the entries."
                  values={{ total: percent(w.total) }}
                />
              </p>
            ))}
          </div>
          <section
            className="overflow-hidden rounded-card border border-border-default bg-raised"
            aria-labelledby={partnersHeading}
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-3">
              <h2 id={partnersHeading} className="text-base font-semibold">
                {historic ? (
                  <FormattedMessage
                    id="entities.partnership.partnersAt"
                    defaultMessage="Register of partners at {date}"
                    values={{ date: day(register.asOf) }}
                  />
                ) : (
                  <FormattedMessage
                    id="entities.partnership.partners"
                    defaultMessage="Register of partners"
                  />
                )}
              </h2>
              <span className="text-xs text-muted">
                <FormattedMessage
                  id="entities.partnership.meta"
                  defaultMessage="{partners, plural, one {# partner} other {# partners}} · derived from {entries, plural, one {# register entry} other {# register entries}}"
                  values={{
                    partners: register.partners.filter((p) => p.status !== "ceased").length,
                    entries: register.entries.filter((e) => e.applied).length,
                  }}
                />
              </span>
              <ExportLink entityId={entity.id} kind="partners" asOf={register.asOf}>
                <FormattedMessage
                  id="entities.register.members.export"
                  defaultMessage="Export register"
                />
              </ExportLink>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-250 text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.partner"
                        defaultMessage="Partner"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.capacity"
                        defaultMessage="Capacity"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage id="entities.partnership.units" defaultMessage="Units" />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.committed"
                        defaultMessage="Committed"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.contributed"
                        defaultMessage="Contributed"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.returned"
                        defaultMessage="Returned"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.unreturned"
                        defaultMessage="Unreturned"
                      />
                    </Header>
                    <Header>
                      <FormattedMessage id="entities.partnership.percent" defaultMessage="%" />
                    </Header>
                    <Header>
                      <FormattedMessage
                        id="entities.partnership.since"
                        defaultMessage="Partner since"
                      />
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
                <tbody>
                  {register.partners.map((p) => {
                    const today = register.partnersToday.find((n) => n.party.id === p.party.id);
                    return (
                      <tr key={p.party.id} className="border-b border-border-muted">
                        <td className="px-3 py-2">
                          <RegisterPartyCell party={p.party} candidates={candidates} />
                        </td>
                        <td className="px-3 py-2">
                          <CapacityPill capacity={p.capacity} status={p.status} />
                        </td>
                        <td className="px-3 py-2 text-end font-mono">{count(p.units)}</td>
                        {(["committed", "contributed", "returned", "unreturned"] as const).map(
                          (k) => (
                            <td key={k} className="px-3 py-2 text-end font-mono whitespace-nowrap">
                              {money(p[k])}
                            </td>
                          ),
                        )}
                        <td className="px-3 py-2 text-end font-mono">{percent(p.percent)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {p.since ? day(p.since) : none}
                        </td>
                        {historic ? (
                          <td className="px-3 py-2">
                            <PartnerChange partner={p} today={today} currency={capitalCurrency} />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-section-header font-medium">
                    <th scope="row" colSpan={2} className="px-3 py-2 text-start">
                      <FormattedMessage id="entities.partnership.total" defaultMessage="Total" />
                    </th>
                    <td className="px-3 py-2 text-end font-mono">{count(register.totals.units)}</td>
                    {(["committed", "contributed", "returned", "unreturned"] as const).map((k) => (
                      <td key={k} className="px-3 py-2 text-end font-mono whitespace-nowrap">
                        {money(register.totals[k])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-end font-mono">
                      {percent(register.partners.reduce((sum, p) => sum + p.percent, 0))}
                    </td>
                    <td className="px-3 py-2">{none}</td>
                    {historic ? (
                      <td className="px-3 py-2 text-end font-mono">
                        <div className="flex flex-col gap-1">
                          <BalanceChange
                            units={register.totalsToday.units - register.totals.units}
                            capital={register.totalsToday.unreturned - register.totals.unreturned}
                            currency={capitalCurrency}
                          />
                          {register.totalsToday.units === register.totals.units &&
                          register.totalsToday.unreturned === register.totals.unreturned
                            ? none
                            : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                </tfoot>
              </table>
            </div>
            {register.partners.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                <FormattedMessage
                  id="entities.partnership.noPartners"
                  defaultMessage="No partners at this date."
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
                  id="entities.partnership.entries"
                  defaultMessage="Register of partnership entries"
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
                        <FormattedMessage id="entities.register.entry.from" defaultMessage="From" />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.register.entry.to" defaultMessage="To" />
                      </Header>
                      <Header>
                        <FormattedMessage
                          id="entities.partnership.capacity"
                          defaultMessage="Capacity"
                        />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.partnership.units" defaultMessage="Units" />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.partnership.percent" defaultMessage="%" />
                      </Header>
                      <Header>
                        <FormattedMessage id="entities.trust.amount" defaultMessage="Amount" />
                      </Header>
                      <Header>
                        <FormattedMessage
                          id="entities.partnership.consideration"
                          defaultMessage="Consideration"
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
                    {shown.map((e) => {
                      const from =
                        e.fromParty ??
                        (["commitment", "contribution", "withdrawal"].includes(e.kind)
                          ? e.party
                          : null);
                      const to = e.toParty ?? (from ? null : e.party);
                      return (
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
                            {from ? (
                              <RegisterPartyCell party={from} candidates={candidates} />
                            ) : (
                              none
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {to ? <RegisterPartyCell party={to} candidates={candidates} /> : none}
                          </td>
                          <td className="px-3 py-2">
                            <CapacityPill capacity={e.capacity} status={e.transfereeStatus} />
                          </td>
                          <td className="px-3 py-2 text-end font-mono">
                            {e.units === null ? none : count(e.units)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono">
                            {e.statedPercent === null ? none : percent(e.statedPercent)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono whitespace-nowrap">
                            {e.amount === null ? none : money(e.amount, e.currency)}
                          </td>
                          <td className="px-3 py-2">{e.consideration || none}</td>
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
                      );
                    })}
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
        <PartnershipEntryDialog
          entityId={entity.id}
          register={register}
          entry={dialog.entry}
          candidates={candidates}
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
      {basisOpen ? (
        <PartnershipBasisDialog
          entityId={entity.id}
          basis={register.basis}
          onClose={() => setBasisOpen(false)}
          onSaved={() => {
            setBasisOpen(false);
            void revalidate();
          }}
        />
      ) : null}
    </section>
  );
}
