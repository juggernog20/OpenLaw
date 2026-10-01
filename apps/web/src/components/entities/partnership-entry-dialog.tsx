// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-014: record or edit a Partnership entry with only the fields its kind permits. */

import { useState } from "react";
import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { api } from "../../lib/api";
import type { EntityRow } from "../../lib/entities";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { currencyFractionDigits, toMajorUnits, toMinorUnits } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  PARTNERSHIP_KINDS,
  kindMessages,
  capacityMessages,
  knownParties,
  type PartnershipRegister,
  type PartnershipEntry,
  type PartnershipEntryBody,
  type PartnershipParty,
} from "../../lib/partnership-register";
import { partyLabel } from "../../lib/trust-register";
import { CurrencySelect } from "../currency-select";
import { DatePicker } from "../date-picker";
import { NumberInput } from "../number-input";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type PartyInput = NonNullable<PartnershipEntryBody["party"]>;
type PartyChoice = { pick: string; entity: string; name: string };
const choice = (party?: PartnershipParty | null): PartyChoice => ({
  pick: party ? `party:${party.id}` : "",
  entity: "",
  name: "",
});
const partyInput = (value: PartyChoice): PartyInput | null =>
  value.pick.startsWith("party:")
    ? { kind: "party", partyId: value.pick.slice(6) }
    : value.pick === "entity" && value.entity
      ? { kind: "entity", entityId: value.entity }
      : value.pick === "individual" && value.name.trim()
        ? { kind: "individual", name: value.name.trim() }
        : null;

function PartnerPicker({
  id,
  label,
  value,
  onChange,
  parties,
  candidates,
  entityId,
  original,
}: Readonly<{
  id: string;
  label: MessageDescriptor;
  value: PartyChoice;
  onChange: (value: PartyChoice) => void;
  parties: PartnershipParty[];
  candidates: EntityRow[];
  entityId: string;
  original?: PartnershipParty | null;
}>) {
  const intl = useIntl();
  return (
    <>
      <Label htmlFor={id} required>
        {intl.formatMessage(label)}
      </Label>
      <select
        id={id}
        className={CONTROL_CLASS}
        value={value.pick}
        onChange={(e) => onChange({ ...value, pick: e.target.value })}
      >
        <option value="">
          {intl.formatMessage({
            id: "entities.partnership.pickPartner",
            defaultMessage: "Choose a Partner…",
          })}
        </option>
        {parties
          .filter((p) => (p.restricted ? p.id === original?.id : p.kind !== "class"))
          .map((p) => (
            <option key={p.id} value={`party:${p.id}`}>
              {partyLabel(intl, p)}
            </option>
          ))}
        <option value="entity">
          {intl.formatMessage({ id: "entities.register.holder.entity", defaultMessage: "Entity" })}
        </option>
        <option value="individual">
          {intl.formatMessage({
            id: "entities.ownership.individual",
            defaultMessage: "Individual",
          })}
        </option>
      </select>
      {value.pick === "entity" ? (
        <>
          <Label htmlFor={`${id}-entity`} required>
            <FormattedMessage id="entities.register.holder.entity" defaultMessage="Entity" />
          </Label>
          <select
            id={`${id}-entity`}
            className={CONTROL_CLASS}
            value={value.entity}
            onChange={(e) => onChange({ ...value, entity: e.target.value })}
          >
            <option value="">
              {intl.formatMessage({
                id: "entities.trust.pickEntity",
                defaultMessage: "Choose an Entity…",
              })}
            </option>
            {candidates
              .filter((c) => c.id !== entityId && c.archivedAt === null)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
          </select>
        </>
      ) : null}
      {value.pick === "individual" ? (
        <>
          <Label htmlFor={`${id}-name`} required>
            <FormattedMessage id="entities.ownership.fullName" defaultMessage="Full name" />
          </Label>
          <Input
            id={`${id}-name`}
            value={value.name}
            maxLength={200}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </>
      ) : null}
    </>
  );
}

export function PartnershipEntryDialog({
  entityId,
  register,
  entry,
  candidates,
  onClose,
  onSaved,
}: Readonly<{
  entityId: string;
  register: PartnershipRegister;
  entry?: PartnershipEntry;
  candidates: EntityRow[];
  onClose: () => void;
  onSaved: () => void;
}>) {
  const intl = useIntl();
  const [kind, setKind] = useState<PartnershipEntry["kind"]>(entry?.kind ?? "admission");
  const [date, setDate] = useState(entry?.effectiveOn ?? register.today);
  const [partner, setPartner] = useState(choice(entry?.party));
  const [from, setFrom] = useState(choice(entry?.fromParty));
  const [to, setTo] = useState(choice(entry?.toParty));
  const [capacity, setCapacity] = useState<"general" | "limited">(entry?.capacity ?? "general");
  // ENT-014: only a transferee with no standing needs the admitted-or-assignee
  // choice. A party admitted or holding as an assignee today keeps that standing
  // unless the entry says otherwise, so "" (no change) is the default for one.
  const stands = (value: PartyChoice) =>
    value.pick.startsWith("party:") &&
    register.partnersToday.some((p) => p.party.id === value.pick.slice(6) && p.status !== "ceased");
  const [status, setStatus] = useState<"admitted" | "assignee" | "">(
    entry?.kind === "transfer" ? (entry.transfereeStatus ?? "") : "admitted",
  );
  const changeTo = (next: PartyChoice) => {
    setTo(next);
    if (next.pick !== to.pick) setStatus(stands(next) ? "" : status || "admitted");
  };
  const [units, setUnits] = useState(entry?.units == null ? "" : String(entry.units));
  const [percent, setPercent] = useState(
    entry?.statedPercent == null ? "" : String(entry.statedPercent),
  );
  // A historic read before the first money entry has no currency yet.
  const registerCurrency =
    register.currency ?? register.entries.find((e) => e.currency)?.currency ?? "";
  const [currency, setCurrency] = useState(entry?.currency ?? registerCurrency);
  const [amount, setAmount] = useState(
    entry?.amount != null && entry.currency
      ? String(toMajorUnits(entry.amount, entry.currency))
      : "",
  );
  const [form, setForm] = useState(entry?.formOfContribution ?? "");
  const [consideration, setConsideration] = useState(entry?.consideration ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transfer = kind === "transfer";
  const balances = kind === "admission" || transfer;
  const moneyRequired = ["commitment", "contribution", "return"].includes(kind);
  const money = moneyRequired || transfer;
  const needsCapacity =
    kind === "admission" || kind === "capacity_change" || (transfer && status === "admitted");
  const parties = knownParties(register);
  async function submit() {
    if (busy) return;
    const party = partyInput(partner),
      fromParty = partyInput(from),
      toParty = partyInput(to);
    const numericUnits = balances && units.trim() ? Number(units) : null;
    const numericPercent = balances && percent.trim() ? Number(percent) : null;
    if (!date || (transfer ? !fromParty || !toParty : !party)) {
      setError(
        intl.formatMessage({
          id: "entities.partnership.entry.required",
          defaultMessage: "Complete the effective date and the Partner details for this entry.",
        }),
      );
      return;
    }
    if (
      (numericUnits !== null &&
        (!/^\d+$/.test(units.trim()) || !Number.isSafeInteger(numericUnits))) ||
      (numericPercent !== null &&
        (!/^\d+(?:\.\d{1,2})?$/.test(percent.trim()) || numericPercent > 100))
    ) {
      setError(
        intl.formatMessage({
          id: "entities.partnership.entry.balances",
          defaultMessage:
            "Enter whole non-negative units and a stated percent from 0 to 100 with up to 2 decimal places.",
        }),
      );
      return;
    }
    let minor: number | null = null;
    if (money && (moneyRequired || amount.trim())) {
      if (!currency) {
        setError(
          intl.formatMessage({
            id: "entities.trust.entry.currencyRequired",
            defaultMessage: "Choose a currency for the amount.",
          }),
        );
        return;
      }
      const digits = currencyFractionDigits(currency);
      const fraction = amount.trim().split(".")[1]?.replace(/0+$/, "").length ?? 0;
      minor = toMinorUnits(Number(amount), currency);
      if (
        !/^\d+(?:\.\d*)?$/.test(amount.trim()) ||
        fraction > digits ||
        !Number.isSafeInteger(minor) ||
        minor <= 0
      ) {
        setError(
          intl.formatMessage(
            {
              id: "entities.trust.entry.amountPrecision",
              defaultMessage: "Enter a positive amount with up to {digits} decimal places.",
            },
            { digits },
          ),
        );
        return;
      }
    }
    if (transfer && !((numericUnits ?? 0) > 0 || (numericPercent ?? 0) > 0 || minor !== null)) {
      setError(
        intl.formatMessage({
          id: "entities.partnership.entry.transferRequired",
          defaultMessage: "Enter units, a stated percent or unreturned capital to transfer.",
        }),
      );
      return;
    }
    const body: PartnershipEntryBody = {
      kind,
      effectiveOn: date,
      party: transfer ? null : party,
      fromParty: transfer ? fromParty : null,
      toParty: transfer ? toParty : null,
      capacity: needsCapacity ? capacity : null,
      transfereeStatus: transfer ? status || null : null,
      units: numericUnits,
      statedPercent: numericPercent,
      amount: minor,
      currency: minor === null ? null : currency,
      formOfContribution: kind === "contribution" ? form.trim() || null : null,
      consideration: transfer ? consideration.trim() || null : null,
      reference: reference.trim() || null,
      note: note.trim() || null,
    };
    setBusy(true);
    setError(null);
    const result = await (
      entry
        ? api.PATCH("/api/v1/entities/{id}/partnership-entries/{entryId}", {
            params: { path: { id: entityId, entryId: entry.id } },
            body,
          })
        : api.POST("/api/v1/entities/{id}/partnership-entries", {
            params: { path: { id: entityId } },
            body,
          })
    ).catch(() => undefined);
    setBusy(false);
    if (!result?.response.ok)
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.trust.entry.saveError",
            defaultMessage: "The entry could not be saved.",
          }),
      );
    else onSaved();
  }
  const pickerProps = { parties, candidates, entityId };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-4rem)] max-w-xl overflow-y-auto"
      >
        <DialogTitle>
          {entry ? (
            <FormattedMessage
              id="entities.register.entry.editTitle"
              defaultMessage="Edit entry {number}"
              values={{ number: String(entry.entryNo).padStart(3, "0") }}
            />
          ) : (
            <FormattedMessage id="entities.register.entry.title" defaultMessage="Record entry" />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="contents">
            <Label htmlFor="partnership-kind" required>
              <FormattedMessage id="entities.register.entry.kind" defaultMessage="Entry" />
            </Label>
            <select
              id="partnership-kind"
              className={CONTROL_CLASS}
              value={kind}
              onChange={(e) => setKind(e.target.value as PartnershipEntry["kind"])}
            >
              {PARTNERSHIP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {intl.formatMessage(kindMessages[k])}
                </option>
              ))}
            </select>
            <Label htmlFor="partnership-date" required>
              <FormattedMessage
                id="entities.register.entry.effectiveOn"
                defaultMessage="Effective date"
              />
            </Label>
            <DatePicker id="partnership-date" value={date} onChange={setDate} />
            {transfer ? (
              <>
                <PartnerPicker
                  {...pickerProps}
                  id="partnership-from"
                  label={{ id: "entities.register.entry.from", defaultMessage: "From" }}
                  value={from}
                  onChange={setFrom}
                  original={entry?.fromParty}
                />
                <PartnerPicker
                  {...pickerProps}
                  id="partnership-to"
                  label={{ id: "entities.register.entry.to", defaultMessage: "To" }}
                  value={to}
                  onChange={changeTo}
                  original={entry?.toParty}
                />
                <Label htmlFor="partnership-status" required>
                  <FormattedMessage
                    id="entities.partnership.transfereeStatus"
                    defaultMessage="Transferee status"
                  />
                </Label>
                <select
                  id="partnership-status"
                  className={CONTROL_CLASS}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "entities.partnership.unchangedStatus",
                      defaultMessage: "No change · already a Partner",
                    })}
                  </option>
                  <option value="admitted">
                    {intl.formatMessage({
                      id: "entities.partnership.admitted",
                      defaultMessage: "Admitted",
                    })}
                  </option>
                  <option value="assignee">{intl.formatMessage(capacityMessages.assignee)}</option>
                </select>
              </>
            ) : (
              <PartnerPicker
                {...pickerProps}
                id="partnership-partner"
                label={{ id: "entities.partnership.partner", defaultMessage: "Partner" }}
                value={partner}
                onChange={setPartner}
                original={entry?.party}
              />
            )}
            {needsCapacity ? (
              <>
                <Label htmlFor="partnership-capacity" required>
                  <FormattedMessage id="entities.partnership.capacity" defaultMessage="Capacity" />
                </Label>
                <select
                  id="partnership-capacity"
                  className={CONTROL_CLASS}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value as typeof capacity)}
                >
                  {(["general", "limited"] as const).map((c) => (
                    <option key={c} value={c}>
                      {intl.formatMessage(capacityMessages[c])}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {balances ? (
              <>
                <Label htmlFor="partnership-units">
                  <FormattedMessage id="entities.partnership.units" defaultMessage="Units" />
                </Label>
                <NumberInput id="partnership-units" value={units} onValueChange={setUnits} />
                <Label htmlFor="partnership-percent">
                  <FormattedMessage
                    id="entities.partnership.basis.stated"
                    defaultMessage="Stated percent"
                  />
                </Label>
                <NumberInput
                  id="partnership-percent"
                  inputMode="decimal"
                  value={percent}
                  onValueChange={setPercent}
                />
              </>
            ) : null}
            {money ? (
              <>
                <Label htmlFor="partnership-amount" required={moneyRequired}>
                  <FormattedMessage id="entities.trust.amount" defaultMessage="Amount" />
                </Label>
                <NumberInput
                  id="partnership-amount"
                  inputMode="decimal"
                  value={amount}
                  onValueChange={setAmount}
                />
                <Label htmlFor="partnership-currency" required={moneyRequired}>
                  <FormattedMessage
                    id="entities.register.classes.currency"
                    defaultMessage="Currency"
                  />
                </Label>
                <CurrencySelect
                  id="partnership-currency"
                  value={currency}
                  onValueChange={setCurrency}
                  disabled={register.entries.some((e) => e.id !== entry?.id && e.currency !== null)}
                />
              </>
            ) : null}
            {kind === "contribution" ? (
              <>
                <Label htmlFor="partnership-form">
                  <FormattedMessage
                    id="entities.partnership.form"
                    defaultMessage="Form of contribution"
                  />
                </Label>
                <textarea
                  id="partnership-form"
                  className={TEXTAREA_CLASS}
                  maxLength={2000}
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                />
              </>
            ) : null}
            {transfer ? (
              <>
                <Label htmlFor="partnership-consideration">
                  <FormattedMessage
                    id="entities.partnership.consideration"
                    defaultMessage="Consideration"
                  />
                </Label>
                <textarea
                  id="partnership-consideration"
                  className={TEXTAREA_CLASS}
                  maxLength={2000}
                  value={consideration}
                  onChange={(e) => setConsideration(e.target.value)}
                />
              </>
            ) : null}
            <Label htmlFor="partnership-reference">
              <FormattedMessage id="entities.trust.reference" defaultMessage="Reference" />
            </Label>
            <Input
              id="partnership-reference"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Label htmlFor="partnership-note">
              <FormattedMessage id="entities.register.entry.note" defaultMessage="Note" />
            </Label>
            <textarea
              id="partnership-note"
              className={TEXTAREA_CLASS}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {entry ? (
                <FormattedMessage id="common.save" defaultMessage="Save" />
              ) : (
                <FormattedMessage
                  id="entities.register.entry.record"
                  defaultMessage="Enter in register"
                />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
