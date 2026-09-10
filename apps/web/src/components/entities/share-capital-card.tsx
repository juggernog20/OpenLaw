// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS } from "../../lib/form-controls";
import type { EntityRow } from "../../lib/entities";
import type { CommitOutcome, FieldStatus } from "../../lib/field-commit";
import {
  currencyFractionDigits,
  currencyOptions,
  toMajorUnits,
  toMinorUnits,
} from "../../lib/format";
import { NumberInput } from "../number-input";
import { StatusNote } from "../status-note";
import { Label } from "../ui/label";

type CapitalKey = "sharesAuthorized" | "sharesIssued" | "parValue";
type CapitalPatch = Partial<Pick<EntityRow, CapitalKey | "parValueCurrency">>;

const CAPITAL_FIELDS: readonly { key: CapitalKey; label: React.ReactNode }[] = [
  {
    key: "sharesAuthorized",
    label: (
      <FormattedMessage
        id="entities.record.shareCapital.authorized"
        defaultMessage="Authorized shares"
      />
    ),
  },
  {
    key: "sharesIssued",
    label: (
      <FormattedMessage id="entities.record.shareCapital.issued" defaultMessage="Issued shares" />
    ),
  },
  {
    key: "parValue",
    label: (
      <FormattedMessage id="entities.record.shareCapital.parValue" defaultMessage="Par value" />
    ),
  },
];

export function ShareCapitalCard({
  entity,
  frozen,
  status,
  error,
  onCommit,
}: Readonly<{
  entity: EntityRow;
  frozen: boolean;
  status: Partial<Record<CapitalKey, FieldStatus>>;
  error: Partial<Record<CapitalKey, string | undefined>>;
  onCommit: (key: CapitalKey, patch: CapitalPatch) => Promise<CommitOutcome>;
}>) {
  const intl = useIntl();
  const [drafts, setDrafts] = useState<Record<CapitalKey, string>>(() => capitalDrafts(entity));
  const [refusals, setRefusals] = useState<Partial<Record<CapitalKey, string>>>({});
  const inFlight = useRef(new Set<CapitalKey>());
  const currency = entity.parValueCurrency ?? "";

  function refuse(key: CapitalKey, detail?: string) {
    setRefusals((current) => ({ ...current, [key]: detail }));
  }

  function parse(key: CapitalKey, code = currency): number | null | undefined {
    const draft = drafts[key].trim();
    if (!draft) return null;
    const amount = Number(draft);
    const digits = key === "parValue" && code ? currencyFractionDigits(code) : 0;
    const fraction = draft.split(".")[1]?.replace(/0+$/, "").length ?? 0;
    const value = key === "parValue" && code ? toMinorUnits(amount, code) : amount;
    if (
      !/^\d+(?:\.\d*)?$/.test(draft) ||
      fraction > digits ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      refuse(
        key,
        key === "parValue"
          ? intl.formatMessage(
              {
                id: "entities.record.shareCapital.invalidAmount",
                defaultMessage: "Enter a non-negative amount with up to {digits} decimal places.",
              },
              { digits },
            )
          : intl.formatMessage({
              id: "entities.record.shareCapital.invalid",
              defaultMessage: "Enter a whole number of zero or more.",
            }),
      );
      return undefined;
    }
    return value;
  }

  async function save(key: CapitalKey, patch: CapitalPatch) {
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key);
    try {
      return (await onCommit(key, patch)).ok;
    } finally {
      inFlight.current.delete(key);
    }
  }

  async function commit(key: CapitalKey) {
    if (key === "parValue" && !currency) return;
    const value = parse(key);
    if (value === undefined) return;
    refuse(key);
    if (value !== entity[key]) {
      await save(
        key,
        key === "parValue" ? { parValue: value, parValueCurrency: currency } : { [key]: value },
      );
    }
  }

  async function changeCurrency(code: string) {
    if (code === currency || inFlight.current.has("parValue")) return;
    // Retain the displayed amount when changing currencies. Legacy values without a
    // currency keep their stored minor units until a currency is first assigned.
    const amount = currency ? parse("parValue", code) : entity.parValue;
    if (amount === undefined) return;
    refuse("parValue");
    if (await save("parValue", { parValue: amount, parValueCurrency: code })) {
      setDrafts((current) => ({
        ...current,
        parValue: amount === null ? "" : String(toMajorUnits(amount, code)),
      }));
    }
  }

  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">
          <FormattedMessage
            id="entities.record.shareCapital.title"
            defaultMessage="Share capital"
          />
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-4 p-4 @lg/page:grid-cols-2 @3xl/page:grid-cols-4">
        {CAPITAL_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`entity-${key}`}>{label}</Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id={`entity-${key}`}
                value={drafts[key]}
                disabled={
                  frozen || (key === "parValue" && (!currency || status.parValue === "saving"))
                }
                onValueChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
                onBlur={() => void commit(key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commit(key);
                  if (event.key === "Escape") {
                    setDrafts((current) => ({ ...current, [key]: capitalDrafts(entity)[key] }));
                    refuse(key);
                  }
                }}
              />
              <StatusNote
                status={refusals[key] === undefined ? (status[key] ?? "idle") : "error"}
                detail={refusals[key] ?? error[key]}
              />
            </div>
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="entity-parValueCurrency">
            <FormattedMessage
              id="entities.record.shareCapital.currency"
              defaultMessage="Currency"
            />
          </Label>
          <select
            className={CONTROL_CLASS}
            id="entity-parValueCurrency"
            value={currency}
            disabled={frozen || status.parValue === "saving"}
            onChange={(event) => void changeCurrency(event.target.value)}
          >
            <option value="" disabled>
              <FormattedMessage
                id="entities.record.shareCapital.chooseCurrency"
                defaultMessage="Choose currency"
              />
            </option>
            {currencyOptions({ locale: intl.locale }).map((option) => (
              <option key={option.code} value={option.code}>
                {option.code} — {option.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

function capitalDrafts(entity: EntityRow): Record<CapitalKey, string> {
  return {
    sharesAuthorized: String(entity.sharesAuthorized ?? ""),
    sharesIssued: String(entity.sharesIssued ?? ""),
    parValue:
      entity.parValue !== null && entity.parValueCurrency
        ? String(toMajorUnits(entity.parValue, entity.parValueCurrency))
        : "",
  };
}

export type { CapitalKey };
