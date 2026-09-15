// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CurrencySelect } from "../currency-select";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { AiField } from "../ui/ai-field";
import { StatusNote, type FieldStatus } from "../status-note";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { toMajorUnits, toMinorUnits } from "../../lib/format";
import {
  cadenceLabel,
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
  cadenceDescription: string;
}

/** The saved value as the controls show it, and as a string that
 * changes only when the value itself does — the seed the draft is reset
 * from when a commit lands. */
function valueDraft(value: ContractValue | null, locale: string): ValueDraft {
  return value === null
    ? { amount: "", currency: "", cadence: "one_time", cadenceDescription: "" }
    : {
        amount: String(toMajorUnits(value.amount, value.currency, { locale })),
        currency: value.currency,
        cadence: value.cadence,
        cadenceDescription: value.cadenceDescription ?? "",
      };
}

function valueSeed(value: ContractValue | null): string {
  return value === null
    ? ""
    : `${value.amount}:${value.currency}:${value.cadence}:${value.cadenceDescription ?? ""}`;
}

function groupedAmount(amount: string): string {
  return amount.replace(
    /^(\d+)(\.\d*)?$/,
    (_, whole: string, fraction: string = "") =>
      whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fraction,
  );
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
  const [editingAmount, setEditingAmount] = useState(false);
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
      // Before the first value is saved, keep the other parts so the
      // person can choose a cadence or currency before entering an amount.
      if (value === null) {
        onStatus("idle");
        return;
      }
      onCommit(null);
      return;
    }

    const validAmount = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$|^\.\d+$/.test(typed);
    const major = Number(typed.replaceAll(",", ""));
    if (!validAmount || !Number.isFinite(major) || major < 0) {
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

    if (draft.cadence === "other" && !draft.cadenceDescription.trim()) {
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.value.customCadenceRequired",
          defaultMessage: "Enter a custom cadence.",
        }),
      );
      return;
    }
    const next: ContractValue = {
      amount: toMinorUnits(major, draft.currency, { locale: intl.locale }),
      currency: draft.currency,
      cadence: draft.cadence,
      ...(draft.cadence === "other" ? { cadenceDescription: draft.cadenceDescription.trim() } : {}),
    };
    if (
      value &&
      next.amount === value.amount &&
      next.currency === value.currency &&
      next.cadence === value.cadence &&
      next.cadenceDescription === value.cadenceDescription
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
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-labelledby="contract-value-label"
          className="flex flex-1 flex-wrap items-end gap-2"
          // Focus moving between the three controls stays inside one
          // field, so only focus leaving the group commits it.
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            commit();
          }}
          onKeyDown={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest("button")) return;
            if (event.key === "Enter") {
              // The record page is not a form; Enter here means commit.
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") revert();
          }}
        >
          <div className="flex w-40 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Label id="contract-value-label" htmlFor="contract-value-amount">
                <FormattedMessage id="contracts.form.value" defaultMessage="Value" />
              </Label>
              {marker}
              <StatusNote status={status} detail={error} />
            </div>
            <AiField active={Boolean(marker)}>
              <Input
                id="contract-value-amount"
                type="text"
                inputMode="decimal"
                disabled={frozen}
                aria-label={intl.formatMessage({
                  id: "contracts.value.amount",
                  defaultMessage: "Amount",
                })}
                value={editingAmount ? draft.amount : groupedAmount(draft.amount)}
                onFocus={() => setEditingAmount(true)}
                onBlur={() => setEditingAmount(false)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, amount: event.target.value }))
                }
              />
            </AiField>
          </div>
          <div className="flex w-56 flex-col gap-1.5">
            <Label htmlFor="contract-value-currency">
              <FormattedMessage id="contracts.value.currency" defaultMessage="Currency" />
            </Label>
            <AiField active={Boolean(marker)}>
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
          </div>
          <div className="flex w-40 flex-col gap-1.5">
            <Label htmlFor="contract-value-cadence">
              <FormattedMessage id="contracts.value.cadence" defaultMessage="Frequency" />
            </Label>
            <AiField active={Boolean(marker)}>
              <select
                id="contract-value-cadence"
                className={CONTROL_CLASS}
                disabled={frozen}
                aria-label={intl.formatMessage({
                  id: "contracts.value.cadence",
                  defaultMessage: "Frequency",
                })}
                value={draft.cadence}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    cadence: event.target.value as ValueCadence,
                  }))
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
          {draft.cadence === "other" && (
            <AiField active={Boolean(marker)} className="min-w-40 flex-1">
              <Input
                id="contract-value-custom-cadence"
                disabled={frozen}
                maxLength={100}
                aria-label={intl.formatMessage({
                  id: "contracts.value.customCadence",
                  defaultMessage: "Custom cadence",
                })}
                placeholder={intl.formatMessage({
                  id: "contracts.value.customCadencePlaceholder",
                  defaultMessage: "e.g. quarter or milestone",
                })}
                value={draft.cadenceDescription}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cadenceDescription: event.target.value }))
                }
              />
            </AiField>
          )}
        </div>
        <span className="flex items-center gap-2">{confirmation}</span>
      </div>
    </div>
  );
}
