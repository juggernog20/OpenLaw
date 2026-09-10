// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { currencyOptions } from "../lib/format";
import { notifyCurrenciesChanged } from "../lib/currencies";
import { AddCurrencyDialog } from "./currency-select";
import { SettingsCard } from "./settings-card";
import { Button } from "./ui/button";

export function CurrenciesSettingsCard({
  initialCurrencies,
}: Readonly<{ initialCurrencies: string[] }>) {
  const intl = useIntl();
  const [currencies, setCurrencies] = useState(initialCurrencies);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string>();
  const title = intl.formatMessage({
    id: "settings.currencies.title",
    defaultMessage: "Currencies in use",
  });
  async function remove(code: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    const result = await api
      .DELETE("/api/v1/org/currencies/{code}", { params: { path: { code } } })
      .catch(() => undefined);
    saving.current = false;
    setBusy(false);
    if (!result?.data) {
      setError((await problem(result)).detail);
      return;
    }
    setCurrencies(result.data.currencies);
    notifyCurrenciesChanged(result.data);
    addButton.current?.focus();
  }
  return (
    <SettingsCard
      title={title}
      actions={
        <Button ref={addButton} disabled={busy} onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage id="currencies.add" defaultMessage="Add new currency" />
        </Button>
      }
    >
      <p className="text-muted">
        <FormattedMessage
          id="settings.currencies.description"
          defaultMessage="Choose the currencies offered in forms across OpenLaw. Removing a currency keeps existing record values intact."
        />
      </p>
      {error && (
        <p role="alert" className="text-status-danger-fg">
          {error}
        </p>
      )}
      <ul
        className="divide-y divide-border-default rounded-card border border-border-default bg-raised"
        aria-label={title}
      >
        {currencyOptions({ locale: intl.locale })
          .filter((option) => currencies.includes(option.code))
          .map((option) => (
            <li key={option.code} className="flex items-center gap-4 px-4 py-3">
              <span className="w-12 shrink-0 font-semibold">{option.code}</span>
              <span className="flex-1">{option.displayName}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                aria-label={intl.formatMessage(
                  { id: "settings.currencies.remove", defaultMessage: "Remove {code}" },
                  { code: option.code },
                )}
                onClick={() => void remove(option.code)}
              >
                <FormattedMessage id="common.remove" defaultMessage="Remove" />
              </Button>
            </li>
          ))}
      </ul>
      {!currencies.length && (
        <p className="text-muted">
          <FormattedMessage
            id="settings.currencies.empty"
            defaultMessage="No currencies added yet."
          />
        </p>
      )}
      {adding && (
        <AddCurrencyDialog
          currencies={currencies}
          onClose={() => {
            setAdding(false);
            addButton.current?.focus();
          }}
          onAdded={(_code, settings) => {
            setCurrencies(settings.currencies);
            setAdding(false);
            addButton.current?.focus();
          }}
        />
      )}
    </SettingsCard>
  );
}
