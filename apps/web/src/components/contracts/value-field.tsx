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
  onDraftChange,
  required = false,
  idPrefix = "contract-value",
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
  onDraftChange?: (value: ContractValue | null, error?: string) => void;
  required?: boolean;
  /** Distinct per mount: the create dialog can open over a record that draws its own Value. */
  idPrefix?: string;
}>) {
  const intl = useIntl();
  const [editingAmount, setEditingAmount] = useState(false);
  const [draft, setDraft] = useState<ValueDraft>(() => valueDraft(value, intl.locale));
  /** The value the draft was last seeded from. Comparing the content
   * rather than the object is what lets another field's commit answer
   * with a fresh row without discarding a half-typed amount here. */
  const [seed, setSeed] = useState(() => valueSeed(value));
  const seeded = valueSeed(value);
  if (!onDraftChange && seed !== seeded) {
    setSeed(seeded);
    setDraft(valueDraft(value, intl.locale));
  }

  function revert() {
    changeDraft(valueDraft(value, intl.locale));
    onStatus("idle");
  }

  function parse(nextDraft: ValueDraft): { value: ContractValue | null; error?: string } {
    const typed = nextDraft.amount.trim();
    if (!typed) return { value: null };
    const major = Number(typed.replaceAll(",", ""));
    const validAmount = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$|^\.\d+$/.test(typed);
    if (!validAmount || !Number.isFinite(major) || major < 0)
      return {
        value: null,
        error: intl.formatMessage({
          id: "contracts.value.amountInvalid",
          defaultMessage: "Enter the amount as a number.",
        }),
      };
    if (!nextDraft.currency)
      return {
        value: null,
        error: intl.formatMessage({
          id: "contracts.value.currencyMissing",
          defaultMessage: "Pick a currency for the amount.",
        }),
      };
    if (nextDraft.cadence === "other" && !nextDraft.cadenceDescription.trim())
      return {
        value: null,
        error: intl.formatMessage({
          id: "contracts.value.customCadenceRequired",
          defaultMessage: "Enter a custom cadence.",
        }),
      };
    const amount = toMinorUnits(major, nextDraft.currency, { locale: intl.locale });
    if (!Number.isSafeInteger(amount))
      return {
        value: null,
        error: intl.formatMessage({
          id: "contracts.value.amountInvalid",
          defaultMessage: "Enter the amount as a number.",
        }),
      };
    return {
      value: {
        amount,
        currency: nextDraft.currency,
        cadence: nextDraft.cadence,
        ...(nextDraft.cadence === "other"
          ? { cadenceDescription: nextDraft.cadenceDescription.trim() }
          : {}),
      },
    };
  }
  function changeDraft(next: ValueDraft) {
    setDraft(next);
    if (onDraftChange) {
      const parsed = parse(next);
      onDraftChange(parsed.value, parsed.error);
    }
  }
  function commit() {
    if (status === "saving") return;
    const parsed = parse(draft);
    if (parsed.error) {
      onStatus("error", parsed.error);
      return;
    }
    if (valueSeed(parsed.value) === valueSeed(value)) {
      onStatus("idle");
      return;
    }
    onCommit(parsed.value);
  }

  return (
    <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-labelledby={`${idPrefix}-label`}
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
              <Label id={`${idPrefix}-label`} htmlFor={`${idPrefix}-amount`} required={required}>
                <FormattedMessage id="contracts.form.value" defaultMessage="Value" />
              </Label>
              {marker}
              <StatusNote status={status} detail={error} />
            </div>
            <AiField active={Boolean(marker)}>
              <Input
                aria-required={required || undefined}
                id={`${idPrefix}-amount`}
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
                onChange={(event) => changeDraft({ ...draft, amount: event.target.value })}
              />
            </AiField>
          </div>
          <div className="flex w-56 flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-currency`}>
              <FormattedMessage id="contracts.value.currency" defaultMessage="Currency" />
            </Label>
            <AiField active={Boolean(marker)}>
              <CurrencySelect
                id={`${idPrefix}-currency`}
                className="w-full"
                disabled={frozen}
                aria-label={intl.formatMessage({
                  id: "contracts.value.currency",
                  defaultMessage: "Currency",
                })}
                value={draft.currency}
                onValueChange={(currency) => changeDraft({ ...draft, currency })}
                placeholder={intl.formatMessage({
                  id: "contracts.value.currencyPlaceholder",
                  defaultMessage: "Currency…",
                })}
              />
            </AiField>
          </div>
          <div className="flex w-40 flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-cadence`}>
              <FormattedMessage id="contracts.value.cadence" defaultMessage="Frequency" />
            </Label>
            <AiField active={Boolean(marker)}>
              <select
                id={`${idPrefix}-cadence`}
                className={CONTROL_CLASS}
                disabled={frozen}
                aria-label={intl.formatMessage({
                  id: "contracts.value.cadence",
                  defaultMessage: "Frequency",
                })}
                value={draft.cadence}
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    cadence: event.target.value as ValueCadence,
                  })
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
                id={`${idPrefix}-custom-cadence`}
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
                  changeDraft({ ...draft, cadenceDescription: event.target.value })
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
