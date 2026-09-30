// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import type { EntityRow } from "../../lib/entities";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { currencyFractionDigits, toMajorUnits, toMinorUnits } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  TRUST_KINDS,
  TRUST_ROLES,
  kindMessages,
  roleMessages,
  knownParties,
  partyLabel,
  type TrustRegister,
  type TrustEntry,
  type TrustEntryBody,
  type TrustRole,
} from "../../lib/trust-register";
import { CurrencySelect } from "../currency-select";
import { DatePicker } from "../date-picker";
import { NumberInput } from "../number-input";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function TrustEntryDialog({
  entityId,
  register,
  entry,
  candidates,
  onClose,
  onSaved,
}: Readonly<{
  entityId: string;
  register: TrustRegister;
  entry?: TrustEntry;
  candidates: EntityRow[];
  onClose: () => void;
  onSaved: () => void;
}>) {
  const intl = useIntl();
  const [kind, setKind] = useState<TrustEntry["kind"]>(entry?.kind ?? "appointment");
  const [date, setDate] = useState(entry?.effectiveOn ?? register.today);
  const [pick, setPick] = useState(entry ? `party:${entry.party.id}` : "");
  const [entity, setEntity] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<TrustRole>(entry?.role ?? "trustee");
  const [roleLabel, setRoleLabel] = useState(entry?.roleLabel ?? "");
  const [interest, setInterest] = useState(entry?.interest ?? "");
  const [form, setForm] = useState(entry?.property ? "property" : "money");
  const [currency, setCurrency] = useState(entry?.currency ?? "");
  const [amount, setAmount] = useState(
    entry?.amount != null && entry.currency
      ? String(toMajorUnits(entry.amount, entry.currency))
      : "",
  );
  const [property, setProperty] = useState(entry?.property ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleEntry = kind === "appointment" || kind === "cessation";
  const allowsClass = kind === "distribution" || (roleEntry && role === "beneficiary");
  const parties = knownParties(register).filter((p) =>
    p.restricted ? p.id === entry?.party.id : p.kind !== "class" || allowsClass,
  );
  const validPick = pick.startsWith("party:")
    ? parties.some((p) => `party:${p.id}` === pick)
    : pick !== "class" || allowsClass;
  const selected = validPick ? pick : "";

  async function submit() {
    if (busy) return;
    let party: TrustEntryBody["party"];
    if (selected.startsWith("party:")) party = { kind: "party", partyId: selected.slice(6) };
    else if (selected === "entity" && entity) party = { kind: "entity", entityId: entity };
    else if (selected === "individual" && name.trim())
      party = { kind: "individual", name: name.trim() };
    else if (selected === "class" && description.trim())
      party = { kind: "class", description: description.trim() };
    else {
      setError(
        intl.formatMessage({
          id: "entities.trust.entry.partyRequired",
          defaultMessage: "Choose a party and fill in its details.",
        }),
      );
      return;
    }
    if (!roleEntry && form === "money" && currency) {
      const digits = currencyFractionDigits(currency);
      const fraction = amount.split(".")[1]?.replace(/0+$/, "").length ?? 0;
      if (!/^\d+(?:\.\d*)?$/.test(amount.trim()) || fraction > digits) {
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
    const minor =
      !roleEntry && form === "money" && currency && amount
        ? toMinorUnits(Number(amount), currency)
        : null;
    if (
      !date ||
      (roleEntry && role === "other" && !roleLabel.trim()) ||
      (!roleEntry &&
        (form === "property"
          ? !property.trim()
          : minor === null || !Number.isSafeInteger(minor) || minor <= 0))
    ) {
      setError(
        intl.formatMessage({
          id: "entities.trust.entry.required",
          defaultMessage: "Complete the effective date and the required fields for this entry.",
        }),
      );
      return;
    }
    const body: TrustEntryBody = {
      kind,
      effectiveOn: date,
      party,
      role: roleEntry ? role : null,
      roleLabel: roleEntry && role === "other" ? roleLabel.trim() : null,
      interest: interest.trim() || null,
      amount: minor,
      currency: minor !== null ? currency : null,
      property: !roleEntry && form === "property" ? property.trim() : null,
      reference: reference.trim() || null,
      note: note.trim() || null,
    };
    setBusy(true);
    setError(null);
    const result = await (
      entry
        ? api.PATCH("/api/v1/entities/{id}/trust-entries/{entryId}", {
            params: { path: { id: entityId, entryId: entry.id } },
            body,
          })
        : api.POST("/api/v1/entities/{id}/trust-entries", {
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
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="contents">
            <Label htmlFor="trust-kind" required>
              <FormattedMessage id="entities.register.entry.kind" defaultMessage="Entry" />
            </Label>
            <select
              id="trust-kind"
              className={CONTROL_CLASS}
              value={kind}
              onChange={(e) => setKind(e.target.value as TrustEntry["kind"])}
            >
              {TRUST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {intl.formatMessage(kindMessages[k])}
                </option>
              ))}
            </select>
            <Label htmlFor="trust-date" required>
              <FormattedMessage
                id="entities.register.entry.effectiveOn"
                defaultMessage="Effective date"
              />
            </Label>
            <DatePicker id="trust-date" value={date} onChange={setDate} />
            <Label htmlFor="trust-party" required>
              <FormattedMessage id="entities.trust.party" defaultMessage="Party" />
            </Label>
            <select
              id="trust-party"
              className={CONTROL_CLASS}
              value={selected}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "entities.trust.pickParty",
                  defaultMessage: "Choose a party…",
                })}
              </option>
              {parties.map((p) => (
                <option key={p.id} value={`party:${p.id}`}>
                  {partyLabel(intl, p)}
                </option>
              ))}
              <option value="entity">
                {intl.formatMessage({
                  id: "entities.register.holder.entity",
                  defaultMessage: "Entity",
                })}
              </option>
              <option value="individual">
                {intl.formatMessage({
                  id: "entities.ownership.individual",
                  defaultMessage: "Individual",
                })}
              </option>
              {allowsClass ? (
                <option value="class">
                  {intl.formatMessage({ id: "entities.trust.class", defaultMessage: "Class" })}
                </option>
              ) : null}
            </select>
            {selected === "entity" ? (
              <>
                <Label htmlFor="trust-entity" required>
                  <FormattedMessage id="entities.register.holder.entity" defaultMessage="Entity" />
                </Label>
                <select
                  id="trust-entity"
                  className={CONTROL_CLASS}
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "entities.trust.pickEntity",
                      defaultMessage: "Choose an Entity…",
                    })}
                  </option>
                  {candidates
                    .filter((c) => c.archivedAt === null)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legalName}
                      </option>
                    ))}
                </select>
              </>
            ) : null}
            {selected === "individual" ? (
              <>
                <Label htmlFor="trust-name" required>
                  <FormattedMessage id="entities.ownership.fullName" defaultMessage="Full name" />
                </Label>
                <Input
                  id="trust-name"
                  value={name}
                  maxLength={200}
                  onChange={(e) => setName(e.target.value)}
                />
              </>
            ) : null}
            {selected === "class" ? (
              <>
                <Label htmlFor="trust-description" required>
                  <FormattedMessage id="entities.trust.description" defaultMessage="Description" />
                </Label>
                <textarea
                  id="trust-description"
                  className={TEXTAREA_CLASS}
                  value={description}
                  maxLength={2000}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </>
            ) : null}
            {roleEntry ? (
              <>
                <Label htmlFor="trust-role" required>
                  <FormattedMessage id="entities.trust.role" defaultMessage="Role" />
                </Label>
                <select
                  id="trust-role"
                  className={CONTROL_CLASS}
                  value={role}
                  onChange={(e) => setRole(e.target.value as TrustRole)}
                >
                  {TRUST_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {intl.formatMessage(roleMessages[r])}
                    </option>
                  ))}
                </select>
                {role === "other" ? (
                  <>
                    <Label htmlFor="trust-role-label" required>
                      <FormattedMessage id="entities.trust.roleLabel" defaultMessage="Role label" />
                    </Label>
                    <Input
                      id="trust-role-label"
                      maxLength={200}
                      value={roleLabel}
                      onChange={(e) => setRoleLabel(e.target.value)}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            <Label htmlFor="trust-interest">
              <FormattedMessage id="entities.trust.interest" defaultMessage="Interest or powers" />
            </Label>
            <textarea
              id="trust-interest"
              className={TEXTAREA_CLASS}
              maxLength={2000}
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
            />
            {!roleEntry ? (
              <>
                <Label htmlFor="trust-form">
                  <FormattedMessage id="entities.trust.form" defaultMessage="Form" />
                </Label>
                <select
                  id="trust-form"
                  className={CONTROL_CLASS}
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                >
                  <option value="money">
                    {intl.formatMessage({ id: "entities.trust.money", defaultMessage: "Money" })}
                  </option>
                  <option value="property">
                    {intl.formatMessage({
                      id: "entities.trust.property",
                      defaultMessage: "Property",
                    })}
                  </option>
                </select>
                {form === "money" ? (
                  <>
                    <Label htmlFor="trust-amount" required>
                      <FormattedMessage id="entities.trust.amount" defaultMessage="Amount" />
                    </Label>
                    <NumberInput
                      id="trust-amount"
                      inputMode="decimal"
                      value={amount}
                      onValueChange={setAmount}
                    />
                    <Label htmlFor="trust-currency" required>
                      <FormattedMessage
                        id="entities.register.classes.currency"
                        defaultMessage="Currency"
                      />
                    </Label>
                    <CurrencySelect
                      id="trust-currency"
                      value={currency}
                      onValueChange={setCurrency}
                    />
                  </>
                ) : (
                  <>
                    <Label htmlFor="trust-property" required>
                      <FormattedMessage id="entities.trust.property" defaultMessage="Property" />
                    </Label>
                    <textarea
                      id="trust-property"
                      className={TEXTAREA_CLASS}
                      maxLength={2000}
                      value={property}
                      onChange={(e) => setProperty(e.target.value)}
                    />
                  </>
                )}
              </>
            ) : null}
            <Label htmlFor="trust-reference">
              <FormattedMessage id="entities.trust.reference" defaultMessage="Reference" />
            </Label>
            <Input
              id="trust-reference"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Label htmlFor="trust-note">
              <FormattedMessage id="entities.register.entry.note" defaultMessage="Note" />
            </Label>
            <textarea
              id="trust-note"
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
