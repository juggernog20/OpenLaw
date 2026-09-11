// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CurrencySelect } from "../currency-select";
import { Input } from "../ui/input";
import { AiField } from "../ui/ai-field";
import { StatusNote, type FieldStatus } from "../status-note";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { currencyFractionDigits, toMajorUnits, toMinorUnits } from "../../lib/format";
import {
  cadenceLabel,
  formatContractValue,
  VALUE_CADENCES,
  type ContractValue,
  type ValueCadence,
} from "../../lib/contracts";

/** What the three controls hold between commits. The amount is a
 * string, in major units, because that is what a person types and an
 * empty box is a state a number cannot hold. */
interface ValueDraft {
  amount: string;
  currency: string;
  cadence: ValueCadence;
}

/** The saved value as the controls show it, and as a string that
 * changes only when the value itself does — the seed the draft is reset
 * from when a commit lands. */
function valueDraft(value: ContractValue | null, locale: string): ValueDraft {
  return value === null
    ? { amount: "", currency: "", cadence: "one_time" }
    : {
        amount: String(toMajorUnits(value.amount, value.currency, { locale })),
        currency: value.currency,
        cadence: value.cadence,
      };
}

function valueSeed(value: ContractValue | null): string {
  return value === null ? "" : `${value.amount}:${value.currency}:${value.cadence}`;
}

/**
 * CTR-010's value: an amount, the ISO 4217 currency it is counted in,
 * and what it is per — three controls that are one field.
 *
 * DES-017 governs it, read as a group rather than as three scalars.
 * Moving between the three controls is moving inside one field, so it
 * commits when focus leaves the group, not when it leaves a control;
 * Enter commits from any of the three; Escape reverts all three, since
 * a half-reverted value would be a value nobody chose. Emptying the
 * amount clears the whole field — no value recorded is the state every
 * contract starts in, and an NDA stays in.
 *
 * The amount is typed in major units and stored in the currency's
 * smallest unit, so the currency decides the conversion; changing it
 * re-scales what is typed at commit time rather than rewriting the box
 * under the person filling it in.
 */
export function ValueField({
  value,
  frozen,
  status,
  error,
  marker,
  confirmation,
  onStatus,
  onCommit,
}: Readonly<{
  value: ContractValue | null;
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  status: FieldStatus;
  error: string | undefined;
  marker?: React.ReactNode;
  confirmation?: React.ReactNode;
  onStatus: (status: FieldStatus, detail?: string) => void;
  onCommit: (value: ContractValue | null) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<ValueDraft>(() => valueDraft(value, intl.locale));
  /** The value the draft was last seeded from. Comparing the content
   * rather than the object is what lets another field's commit answer
   * with a fresh row without discarding a half-typed amount here. */
  const [seed, setSeed] = useState(() => valueSeed(value));
  const seeded = valueSeed(value);
  if (seed !== seeded) {
    setSeed(seeded);
    setDraft(valueDraft(value, intl.locale));
  }

  /** A step of one smallest unit: cents for USD, whole yen for JPY. The
   * box refuses a precision the currency cannot hold. */
  const step =
    draft.currency === ""
      ? 0.01
      : 10 **
        -currencyFractionDigits(draft.currency, {
          locale: intl.locale,
        });

  function revert() {
    setDraft(valueDraft(value, intl.locale));
    onStatus("idle");
  }

  function commit() {
    // Enter already committed this draft and the PATCH is in flight —
    // the blur that follows must not send a duplicate.
    if (status === "saving") return;
    const typed = draft.amount.trim();

    if (typed === "") {
      // An empty amount is how the whole field is cleared. With nothing
      // recorded there is nothing to clear, so the group reverts —
      // a currency picked and then abandoned is not a value.
      if (value === null) {
        revert();
        return;
      }
      onCommit(null);
      return;
    }

    const major = Number(typed);
    if (!Number.isFinite(major) || major < 0) {
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.value.amountInvalid",
          defaultMessage: "Enter the amount as a number.",
        }),
      );
      return;
    }
    if (draft.currency === "") {
      // The seam refuses this too, and the database refuses it again.
      // Saying so here keeps a round trip out of a mistake the form can
      // see for itself — the same guard an empty title already gets.
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.value.currencyMissing",
          defaultMessage: "Pick a currency for the amount.",
        }),
      );
      return;
    }

    const next: ContractValue = {
      amount: toMinorUnits(major, draft.currency, { locale: intl.locale }),
      currency: draft.currency,
      cadence: draft.cadence,
    };
    if (
      value &&
      next.amount === value.amount &&
      next.currency === value.currency &&
      next.cadence === value.cadence
    ) {
      // Nothing changed: commit nothing (DES-017), and drop any
      // refusal the last attempt left standing.
      onStatus("idle");
      return;
    }
    onCommit(next);
  }

  return (
    <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
      <div className="flex items-center gap-2">
        <span id="contract-value-label" className="text-sm font-medium text-primary">
          <FormattedMessage id="contracts.form.value" defaultMessage="Value" />
        </span>
        {marker}
        <StatusNote status={status} detail={error} />
      </div>
      {/* The review controls sit beside the group, never inside it.
          The group takes Enter as a commit and cancels the key, so a
          button within it could never be pressed with the keyboard.
          The group names the value's three controls and nothing else. */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-labelledby="contract-value-label"
          className="flex flex-1 flex-wrap items-center gap-2"
          // Focus moving between the three controls stays inside one
          // field, so only focus leaving the group commits it.
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // The record page is not a form; Enter here means commit.
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") revert();
          }}
        >
          <AiField active={Boolean(marker)} className="w-40">
            <Input
              id="contract-value-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step={step}
              disabled={frozen}
              aria-label={intl.formatMessage({
                id: "contracts.value.amount",
                defaultMessage: "Amount",
              })}
              value={draft.amount}
              onChange={(event) =>
                setDraft((current) => ({ ...current, amount: event.target.value }))
              }
            />
          </AiField>
          <AiField active={Boolean(marker)} className="w-56">
            <CurrencySelect
              id="contract-value-currency"
              className="w-full"
              disabled={frozen}
              aria-label={intl.formatMessage({
                id: "contracts.value.currency",
                defaultMessage: "Currency",
              })}
              value={draft.currency}
              onValueChange={(currency) => setDraft((current) => ({ ...current, currency }))}
              placeholder={intl.formatMessage({
                id: "contracts.value.currencyPlaceholder",
                defaultMessage: "Currency…",
              })}
            />
          </AiField>
          <AiField active={Boolean(marker)} className="w-40">
            <select
              id="contract-value-cadence"
              className={CONTROL_CLASS}
              disabled={frozen}
              aria-label={intl.formatMessage({
                id: "contracts.value.cadence",
                defaultMessage: "Cadence",
              })}
              value={draft.cadence}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cadence: event.target.value as ValueCadence }))
              }
            >
              {/* No empty option: an amount always says what it is per, and
              a one-off is a cadence, not the absence of one (CTR-010). */}
              {VALUE_CADENCES.map((cadence) => (
                <option key={cadence} value={cadence}>
                  {cadenceLabel(intl, cadence)}
                </option>
              ))}
            </select>
          </AiField>
        </div>
        <span className="flex items-center gap-2">{confirmation}</span>
      </div>
      {/* Only once there is a value to read back. Empty, the three
          controls are the whole field: they already say the amount is
          blank, so a line under them saying the same is noise. */}
      {value && (
        <>
          {/* What the record says it is worth, read back as DES-014
              renders it — the three controls hold the parts, this is
              the field. */}
          <p className="text-md">{formatContractValue(intl, value)}</p>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="contracts.value.hint"
              defaultMessage="Empty the amount to take the value off."
            />
          </p>
        </>
      )}
    </div>
  );
}
