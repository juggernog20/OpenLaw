// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState, type ComponentPropsWithoutRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { notifyCurrenciesChanged, useCurrencies } from "../lib/currencies";
import { currencyOptions } from "../lib/format";
import { CONTROL_CLASS } from "../lib/form-controls";
import { problem } from "../lib/problem";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export function AddCurrencyDialog({ currencies, onAdded, onClose }: Readonly<{
  currencies: readonly string[];
  onAdded: (code: string) => void;
  onClose: () => void;
}>) {
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const options = currencyOptions({ locale: intl.locale }).filter((option) => !currencies.includes(option.code) && `${option.code} ${option.displayName}`.toLocaleLowerCase(intl.locale).includes(query.trim().toLocaleLowerCase(intl.locale)));
  async function add(code: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    const result = await api.POST("/api/v1/org/currencies", { body: { code } }).catch(() => undefined);
    saving.current = false;
    setBusy(false);
    if (!result?.data) { setError((await problem(result)).detail); return; }
    notifyCurrenciesChanged();
    onAdded(code);
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent width="md" aria-describedby={undefined} onBlur={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => { event.preventDefault(); onClose(); }}>
      <DialogTitle><FormattedMessage id="currencies.add" defaultMessage="Add new currency" /></DialogTitle>
      <Input className="mt-4" type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={intl.formatMessage({ id: "currencies.search", defaultMessage: "Search currencies" })} placeholder={intl.formatMessage({ id: "currencies.searchPlaceholder", defaultMessage: "Search by currency code or name" })} />
      {error && <p role="alert" className="mt-3 text-status-danger-fg">{error}</p>}
      <ul className="mt-3 max-h-72 overflow-y-auto" aria-label={intl.formatMessage({ id: "currencies.available", defaultMessage: "Available currencies" })}>
        {options.map((option) => <li key={option.code}><Button variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => void add(option.code)}><span className="w-10 shrink-0 font-medium">{option.code}</span><span className="text-left">{option.displayName}</span></Button></li>)}
      </ul>
      {!options.length && <p className="py-4 text-muted"><FormattedMessage id="currencies.noMatches" defaultMessage="No currencies match your search." /></p>}
      <div className="mt-4 flex justify-end"><Button variant="secondary" disabled={busy} onClick={onClose}><FormattedMessage id="common.cancel" defaultMessage="Cancel" /></Button></div>
    </DialogContent>
  </Dialog>;
}

const ADD = "__add_currency__";
export function CurrencySelect({ value, onValueChange, placeholder, className, onBlur, onKeyDown, ...props }: Omit<ComponentPropsWithoutRef<"select">, "value" | "onChange" | "children"> & {
  value: string;
  onValueChange: (code: string) => void;
  placeholder?: string;
}) {
  const intl = useIntl();
  const settings = useCurrencies();
  const select = useRef<HTMLSelectElement>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const codes = new Set([...settings.currencies, ...added, ...(value ? [value] : [])]);
  const options = currencyOptions({ locale: intl.locale }).filter((option) => codes.has(option.code));
  function close() { setAdding(false); select.current?.focus(); }
  return <>
    <select {...props} ref={select} value={value} className={cn(CONTROL_CLASS, className)} aria-busy={settings.loading || undefined}
      onBlur={(event) => { if (adding) event.stopPropagation(); else onBlur?.(event); }}
      onKeyDown={onKeyDown}
      onChange={(event) => { if (event.target.value === ADD) setAdding(true); else onValueChange(event.target.value); }}>
      <option value="">{placeholder ?? intl.formatMessage({ id: "currencies.choose", defaultMessage: "Choose currency" })}</option>
      {value && !options.some((option) => option.code === value) && <option value={value}>{value}</option>}
      {options.map((option) => <option key={option.code} value={option.code}>{option.code} — {option.displayName}</option>)}
      {settings.canManage && <option value={ADD}>{intl.formatMessage({ id: "currencies.add", defaultMessage: "Add new currency" })}</option>}
    </select>
    {settings.error && <span role="alert" className="text-xs text-status-danger-fg">{settings.error} <Button variant="ghost" size="sm" onClick={settings.reload}><FormattedMessage id="currencies.retry" defaultMessage="Retry" /></Button></span>}
    {adding && <AddCurrencyDialog currencies={[...codes]} onClose={close} onAdded={(code) => { setAdded((current) => [...current, code]); onValueChange(code); close(); }} />}
  </>;
}
