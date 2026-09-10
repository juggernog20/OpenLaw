// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { requireUser } from "../lib/session";
import { problem } from "../lib/problem";
import { currencyOptions } from "../lib/format";
import { notifyCurrenciesChanged } from "../lib/currencies";
import { AddCurrencyDialog } from "../components/currency-select";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";

export async function settingsCurrenciesLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/org/currencies");
  if (!data) throw new Error("The currencies in use could not be read.");
  return data;
}

export function SettingsCurrenciesPage() {
  const intl = useIntl();
  const loaded = useLoaderData<typeof settingsCurrenciesLoader>();
  const [currencies, setCurrencies] = useState(loaded.currencies);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string>();
  const title = intl.formatMessage({ id: "settings.currencies.title", defaultMessage: "Currencies in use" });
  async function remove(code: string) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(undefined);
    const result = await api.DELETE("/api/v1/org/currencies/{code}", { params: { path: { code } } }).catch(() => undefined);
    saving.current = false; setBusy(false);
    if (!result?.data) { setError((await problem(result)).detail); return; }
    setCurrencies(result.data.currencies);
    notifyCurrenciesChanged();
    addButton.current?.focus();
  }
  return <div className="flex max-w-3xl flex-col gap-5">
    <PageTitle title={title} />
    <div className="flex items-center justify-between gap-4"><h1 className="text-xl font-semibold">{title}</h1><Button ref={addButton} disabled={busy} onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /><FormattedMessage id="currencies.add" defaultMessage="Add new currency" /></Button></div>
    <p className="text-muted"><FormattedMessage id="settings.currencies.description" defaultMessage="Choose the currencies offered in forms across OpenLaw. Removing a currency keeps existing record values intact." /></p>
    {error && <p role="alert" className="text-status-danger-fg">{error}</p>}
    <ul className="divide-y divide-border-default rounded-card border border-border-default bg-raised" aria-label={title}>
      {currencyOptions({ locale: intl.locale }).filter((option) => currencies.includes(option.code)).map((option) => <li key={option.code} className="flex items-center gap-4 px-4 py-3"><span className="w-12 shrink-0 font-semibold">{option.code}</span><span className="flex-1">{option.displayName}</span><Button variant="secondary" size="sm" disabled={busy} aria-label={intl.formatMessage({ id: "settings.currencies.remove", defaultMessage: "Remove {code}" }, { code: option.code })} onClick={() => void remove(option.code)}><FormattedMessage id="common.remove" defaultMessage="Remove" /></Button></li>)}
    </ul>
    {!currencies.length && <p className="text-muted"><FormattedMessage id="settings.currencies.empty" defaultMessage="No currencies added yet." /></p>}
    {adding && <AddCurrencyDialog currencies={currencies} onClose={() => { setAdding(false); addButton.current?.focus(); }} onAdded={(code) => { setCurrencies((current) => [...new Set([...current, code])]); setAdding(false); addButton.current?.focus(); }} />}
  </div>;
}
