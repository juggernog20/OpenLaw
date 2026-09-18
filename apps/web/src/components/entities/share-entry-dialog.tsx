// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-088's Record entry dialog (ENT-011): one column of fields in the
 * order kind, date, from, to, class, shares, price, consideration,
 * distinctive numbers, resolution, note, then the certificates the entry
 * cancels and issues. The same dialog edits an entry.
 */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityRow } from "../../lib/entities";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { currencyFractionDigits, toMajorUnits, toMinorUnits } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  entryKindLabel,
  knownHolders,
  SHARE_ENTRY_KINDS,
  type RegisterEntry,
  type ShareEntryBody,
  type ShareEntryKind,
  type ShareRegister,
} from "../../lib/share-register";
import { CurrencySelect } from "../currency-select";
import { DatePicker } from "../date-picker";
import { NumberInput } from "../number-input";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Side = "from" | "to";
type HolderChoice = { pick: string; entityId: string; name: string };
type IssuedDraft = { number: string; holder: Side; quantity: string; distinctiveNumbers: string };

/** Which ends a kind takes: true required, false refused, null optional. */
const SIDES: Record<ShareEntryKind, { from: boolean | null; to: boolean | null }> = {
  allotment: { from: false, to: true },
  transfer: { from: true, to: true },
  buyback: { from: true, to: false },
  cancellation: { from: null, to: false },
  conversion: { from: true, to: false },
};

const NONE: HolderChoice = { pick: "", entityId: "", name: "" };

function holderBody(choice: HolderChoice): ShareEntryBody["from"] {
  if (choice.pick.startsWith("holder:")) return { kind: "holder", holderId: choice.pick.slice(7) };
  if (choice.pick === "entity") return { kind: "entity", entityId: choice.entityId };
  if (choice.pick === "individual") return { kind: "individual", name: choice.name.trim() };
  return null;
}

export function ShareEntryDialog({
  entityId,
  register,
  entry,
  candidates,
  onOpenChange,
  onSaved,
}: Readonly<{
  entityId: string;
  /** The loaded register: classes and holders. Live certificates come from a fresh read. */
  register: ShareRegister;
  entry?: RegisterEntry;
  candidates: EntityRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (register: ShareRegister) => void;
}>) {
  const intl = useIntl();
  const live = register.classes.filter((row) => row.archivedAt === null);
  const [today, setToday] = useState<ShareRegister | null>(
    register.asOf === register.today ? register : null,
  );
  const [kind, setKind] = useState<ShareEntryKind>(entry?.kind ?? "allotment");
  const [effectiveOn, setEffectiveOn] = useState(entry?.effectiveOn ?? register.today);
  const [shareClassId, setShareClassId] = useState(entry?.shareClassId ?? live[0]?.id ?? "");
  const [toShareClassId, setToShareClassId] = useState(entry?.toShareClassId ?? "");
  const [quantity, setQuantity] = useState(entry ? String(entry.quantity) : "");
  // A holder the editor cannot see stays on the entry, by id: the API
  // refuses an edit that would replace or drop it (ENT-011).
  const [from, setFrom] = useState<HolderChoice>(
    entry?.from ? { ...NONE, pick: `holder:${entry.from.id}` } : NONE,
  );
  const [to, setTo] = useState<HolderChoice>(
    entry?.to ? { ...NONE, pick: `holder:${entry.to.id}` } : NONE,
  );
  const [price, setPrice] = useState(
    entry?.pricePerShare !== null && entry?.pricePerShare !== undefined && entry.priceCurrency
      ? String(toMajorUnits(entry.pricePerShare, entry.priceCurrency))
      : "",
  );
  const [currency, setCurrency] = useState(entry?.priceCurrency ?? "");
  const [consideration, setConsideration] = useState(entry?.consideration ?? "");
  const [distinctive, setDistinctive] = useState(entry?.distinctiveNumbers ?? "");
  const [resolution, setResolution] = useState(entry?.resolutionRef ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [cancelled, setCancelled] = useState<string[]>(entry?.certificatesCancelled ?? []);
  const [issued, setIssued] = useState<IssuedDraft[]>(
    (entry?.certificatesIssued ?? []).map((certificate) => ({
      number: certificate.number,
      holder: certificate.holderId === entry?.from?.id ? "from" : "to",
      quantity: String(certificate.quantity),
      distinctiveNumbers: certificate.distinctiveNumbers ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live certificates are today's, whatever date the tab is scrubbed to.
  useEffect(() => {
    if (today) return;
    let cancelledRead = false;
    void api
      .GET("/api/v1/entities/{id}/share-register", { params: { path: { id: entityId } } })
      .then((result) => {
        if (cancelledRead) return;
        if (result.data) setToday(result.data);
        else throw new Error("unreadable");
      })
      .catch(() => {
        if (cancelledRead) return;
        setError(
          intl.formatMessage({
            id: "entities.register.entry.liveReadError",
            defaultMessage: "Today's certificates could not be read. Close and try again.",
          }),
        );
      });
    return () => {
      cancelledRead = true;
    };
  }, [entityId, today, intl]);

  const holders = knownHolders(today ?? register);
  const sides = SIDES[kind];
  const fromHolderId = from.pick.startsWith("holder:") ? from.pick.slice(7) : null;
  const cancellable = (today?.holders ?? [])
    .filter(
      (row) =>
        !row.holder.restricted &&
        row.holder.id === fromHolderId &&
        row.shareClassId === shareClassId,
    )
    .flatMap((row) => row.certificates)
    // An edited entry's own cancellations are live again for it.
    .concat(entry?.certificatesCancelled ?? [])
    .filter((number, index, all) => all.indexOf(number) === index)
    .sort();

  function body(): ShareEntryBody | null {
    const count = Number(quantity);
    if (!/^\d+$/.test(quantity.trim()) || count < 1) {
      setError(
        intl.formatMessage({
          id: "entities.register.entry.sharesRequired",
          defaultMessage: "Enter a whole number of shares, one or more.",
        }),
      );
      return null;
    }
    if (!shareClassId) {
      setError(
        intl.formatMessage({
          id: "entities.register.entry.classRequired",
          defaultMessage: "Pick a share class.",
        }),
      );
      return null;
    }
    const fromBody = sides.from === false ? null : holderBody(from);
    const toBody = sides.to === false ? null : holderBody(to);
    if (sides.from === true && !fromBody) {
      setError(
        intl.formatMessage({
          id: "entities.register.entry.fromRequired",
          defaultMessage: "Pick the holder the shares come from.",
        }),
      );
      return null;
    }
    if (sides.to === true && !toBody) {
      setError(
        intl.formatMessage({
          id: "entities.register.entry.toRequired",
          defaultMessage: "Pick the holder the shares go to.",
        }),
      );
      return null;
    }
    for (const chosen of [fromBody, toBody]) {
      if (chosen?.kind === "entity" && !chosen.entityId) {
        setError(
          intl.formatMessage({
            id: "entities.register.entry.entityRequired",
            defaultMessage: "Pick an Entity from the registry.",
          }),
        );
        return null;
      }
      if (chosen?.kind === "individual" && !chosen.name) {
        setError(
          intl.formatMessage({
            id: "entities.register.entry.nameRequired",
            defaultMessage: "Enter the individual's name.",
          }),
        );
        return null;
      }
    }
    let pricePerShare: number | null = null;
    if (price.trim()) {
      if (!currency) {
        setError(
          intl.formatMessage({
            id: "entities.register.entry.currencyRequired",
            defaultMessage: "Pick the price's currency.",
          }),
        );
        return null;
      }
      const digits = currencyFractionDigits(currency);
      const fraction = price.split(".")[1]?.replace(/0+$/, "").length ?? 0;
      if (!/^\d+(?:\.\d*)?$/.test(price.trim()) || fraction > digits) {
        setError(
          intl.formatMessage(
            {
              id: "entities.record.shareCapital.invalidAmount",
              defaultMessage: "Enter a non-negative amount with up to {digits} decimal places.",
            },
            { digits },
          ),
        );
        return null;
      }
      pricePerShare = toMinorUnits(Number(price), currency);
    }
    const certificatesIssued: NonNullable<ShareEntryBody["certificatesIssued"]> = [];
    for (const draft of issued) {
      const number = draft.number.trim();
      if (!number || !/^\d+$/.test(draft.quantity.trim()) || Number(draft.quantity) < 1) {
        setError(
          intl.formatMessage({
            id: "entities.register.entry.certificateInvalid",
            defaultMessage: "Each issued certificate needs a number and a share count.",
          }),
        );
        return null;
      }
      certificatesIssued.push({
        number,
        holder: draft.holder,
        quantity: Number(draft.quantity),
        distinctiveNumbers: draft.distinctiveNumbers.trim() || null,
      });
    }
    return {
      kind,
      effectiveOn,
      shareClassId,
      toShareClassId: kind === "conversion" ? toShareClassId || null : null,
      quantity: count,
      from: fromBody,
      to: kind === "conversion" ? null : toBody,
      pricePerShare,
      priceCurrency: pricePerShare === null ? null : currency,
      consideration: consideration.trim() || null,
      distinctiveNumbers: distinctive.trim() || null,
      resolutionRef: resolution.trim() || null,
      note: note.trim() || null,
      certificatesCancelled: cancelled,
      certificatesIssued,
    };
  }

  async function submit() {
    const payload = body();
    if (!payload) return;
    setBusy(true);
    setError(null);
    const result = entry
      ? await api
          .PATCH("/api/v1/entities/{id}/share-entries/{entryId}", {
            params: { path: { id: entityId, entryId: entry.id } },
            body: payload,
          })
          .catch(() => undefined)
      : await api
          .POST("/api/v1/entities/{id}/share-entries", {
            params: { path: { id: entityId } },
            body: payload,
          })
          .catch(() => undefined);
    setBusy(false);
    if (!result?.data) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.register.entry.saveError",
            defaultMessage: "The entry could not be recorded.",
          }),
      );
      return;
    }
    onSaved(result.data);
  }

  const holderField = (side: Side, choice: HolderChoice, set: (next: HolderChoice) => void) => {
    const required = sides[side] === true;
    const id = `share-entry-${side}`;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} required={required}>
          {side === "from" ? (
            <FormattedMessage id="entities.register.entry.from" defaultMessage="From" />
          ) : (
            <FormattedMessage id="entities.register.entry.to" defaultMessage="To" />
          )}
        </Label>
        <select
          id={id}
          className={CONTROL_CLASS}
          value={choice.pick}
          onChange={(event) => set({ ...NONE, pick: event.target.value })}
        >
          <option value="">
            {side === "from" && kind === "cancellation"
              ? intl.formatMessage({
                  id: "entities.register.entry.treasury",
                  defaultMessage: "Treasury (shares the company holds)",
                })
              : intl.formatMessage({
                  id: "entities.register.entry.pickHolder",
                  defaultMessage: "Pick a holder…",
                })}
          </option>
          {holders.map((holder) => (
            <option key={holder.id} value={`holder:${holder.id}`}>
              {holder.name}
            </option>
          ))}
          {choice.pick.startsWith("holder:") &&
          !holders.some((holder) => `holder:${holder.id}` === choice.pick) ? (
            <option value={choice.pick}>
              {intl.formatMessage({
                id: "entities.restricted",
                defaultMessage: "Restricted Entity",
              })}
            </option>
          ) : null}
          <option value="entity">
            {intl.formatMessage({
              id: "entities.register.entry.entityFromRegistry",
              defaultMessage: "Entity from the registry…",
            })}
          </option>
          <option value="individual">
            {intl.formatMessage({
              id: "entities.register.entry.newIndividual",
              defaultMessage: "New individual…",
            })}
          </option>
        </select>
        {choice.pick === "entity" ? (
          <select
            aria-label={intl.formatMessage({
              id: "entities.register.entry.entity",
              defaultMessage: "Entity",
            })}
            className={CONTROL_CLASS}
            value={choice.entityId}
            onChange={(event) => set({ ...choice, entityId: event.target.value })}
          >
            <option value="">
              {intl.formatMessage({
                id: "entities.register.entry.pickEntity",
                defaultMessage: "Pick an Entity…",
              })}
            </option>
            {candidates
              .filter((candidate) => candidate.id !== entityId && candidate.archivedAt === null)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.legalName}
                </option>
              ))}
          </select>
        ) : null}
        {choice.pick === "individual" ? (
          <Input
            aria-label={intl.formatMessage({
              id: "entities.ownership.fullName",
              defaultMessage: "Full name",
            })}
            maxLength={200}
            placeholder={intl.formatMessage({
              id: "entities.ownership.fullName",
              defaultMessage: "Full name",
            })}
            value={choice.name}
            onChange={(event) => set({ ...choice, name: event.target.value })}
          />
        ) : null}
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-kind" required>
                  <FormattedMessage id="entities.register.entry.kind" defaultMessage="Entry" />
                </Label>
                <select
                  id="share-entry-kind"
                  className={CONTROL_CLASS}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as ShareEntryKind);
                    setCancelled([]);
                    setIssued([]);
                  }}
                >
                  {SHARE_ENTRY_KINDS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {entryKindLabel(intl, candidate)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-date" required>
                  <FormattedMessage
                    id="entities.register.entry.effectiveOn"
                    defaultMessage="Effective date"
                  />
                </Label>
                <DatePicker id="share-entry-date" value={effectiveOn} onChange={setEffectiveOn} />
              </div>
            </div>
            {sides.from !== false ? holderField("from", from, setFrom) : null}
            {sides.to !== false ? holderField("to", to, setTo) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-class" required>
                  {kind === "conversion" ? (
                    <FormattedMessage
                      id="entities.register.entry.fromClass"
                      defaultMessage="From class"
                    />
                  ) : (
                    <FormattedMessage id="entities.register.entry.class" defaultMessage="Class" />
                  )}
                </Label>
                <select
                  id="share-entry-class"
                  className={CONTROL_CLASS}
                  value={shareClassId}
                  onChange={(event) => {
                    setShareClassId(event.target.value);
                    setCancelled([]);
                  }}
                >
                  {live.map((shareClass) => (
                    <option key={shareClass.id} value={shareClass.id}>
                      {shareClass.name}
                    </option>
                  ))}
                </select>
              </div>
              {kind === "conversion" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-entry-to-class" required>
                    <FormattedMessage
                      id="entities.register.entry.toClass"
                      defaultMessage="To class"
                    />
                  </Label>
                  <select
                    id="share-entry-to-class"
                    className={CONTROL_CLASS}
                    value={toShareClassId}
                    onChange={(event) => setToShareClassId(event.target.value)}
                  >
                    <option value="">
                      {intl.formatMessage({
                        id: "entities.register.entry.pickClass",
                        defaultMessage: "Pick a class…",
                      })}
                    </option>
                    {live
                      .filter((shareClass) => shareClass.id !== shareClassId)
                      .map((shareClass) => (
                        <option key={shareClass.id} value={shareClass.id}>
                          {shareClass.name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-entry-quantity" required>
                    <FormattedMessage id="entities.register.entry.shares" defaultMessage="Shares" />
                  </Label>
                  <NumberInput
                    id="share-entry-quantity"
                    inputMode="numeric"
                    value={quantity}
                    onValueChange={setQuantity}
                  />
                </div>
              )}
            </div>
            {kind === "conversion" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-quantity" required>
                  <FormattedMessage id="entities.register.entry.shares" defaultMessage="Shares" />
                </Label>
                <NumberInput
                  id="share-entry-quantity"
                  inputMode="numeric"
                  value={quantity}
                  onValueChange={setQuantity}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-price">
                  <FormattedMessage
                    id="entities.register.entry.price"
                    defaultMessage="Price per share"
                  />
                </Label>
                <NumberInput
                  id="share-entry-price"
                  inputMode="decimal"
                  value={price}
                  onValueChange={setPrice}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-currency">
                  <FormattedMessage
                    id="entities.register.classes.currency"
                    defaultMessage="Currency"
                  />
                </Label>
                <CurrencySelect
                  id="share-entry-currency"
                  value={currency}
                  onValueChange={setCurrency}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-entry-consideration">
                <FormattedMessage
                  id="entities.register.entry.consideration"
                  defaultMessage="Consideration"
                />
              </Label>
              <Input
                id="share-entry-consideration"
                maxLength={500}
                value={consideration}
                onChange={(event) => setConsideration(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-distinctive">
                  <FormattedMessage
                    id="entities.register.entry.distinctive"
                    defaultMessage="Distinctive numbers"
                  />
                </Label>
                <Input
                  id="share-entry-distinctive"
                  maxLength={200}
                  value={distinctive}
                  onChange={(event) => setDistinctive(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-entry-resolution">
                  <FormattedMessage
                    id="entities.register.entry.resolution"
                    defaultMessage="Resolution reference"
                  />
                </Label>
                <Input
                  id="share-entry-resolution"
                  maxLength={200}
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-entry-note">
                <FormattedMessage id="entities.register.entry.note" defaultMessage="Note" />
              </Label>
              <textarea
                id="share-entry-note"
                className={TEXTAREA_CLASS}
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2 rounded-card border border-border-default p-3">
              <p className="text-sm font-semibold">
                <FormattedMessage
                  id="entities.register.entry.certificates"
                  defaultMessage="Certificates"
                />
              </p>
              {sides.from !== false ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">
                    <FormattedMessage id="entities.register.entry.cancel" defaultMessage="Cancel" />
                  </span>
                  {cancellable.length === 0 ? (
                    <p className="text-xs text-muted">
                      <FormattedMessage
                        id="entities.register.entry.noCertificates"
                        defaultMessage="The holder the shares come from has no live certificate in this class."
                      />
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {cancellable.map((number) => (
                        <label key={number} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={cancelled.includes(number)}
                            onCheckedChange={(checked) =>
                              setCancelled((current) =>
                                checked
                                  ? [...current, number]
                                  : current.filter((candidate) => candidate !== number),
                              )
                            }
                          />
                          <span className="font-mono text-sm">{number}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">
                  <FormattedMessage id="entities.register.entry.issue" defaultMessage="Issue" />
                </span>
                {issued.map((draft, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2"
                  >
                    <Input
                      aria-label={intl.formatMessage({
                        id: "entities.register.entry.certificateNumber",
                        defaultMessage: "Certificate number",
                      })}
                      placeholder={intl.formatMessage({
                        id: "entities.register.entry.certificateNumberShort",
                        defaultMessage: "No.",
                      })}
                      maxLength={50}
                      value={draft.number}
                      onChange={(event) =>
                        setIssued((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, number: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <select
                      aria-label={intl.formatMessage({
                        id: "entities.register.entry.certificateHolder",
                        defaultMessage: "Certificate holder",
                      })}
                      className={CONTROL_CLASS}
                      value={draft.holder}
                      onChange={(event) =>
                        setIssued((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, holder: event.target.value as Side } : row,
                          ),
                        )
                      }
                    >
                      {sides.from !== false ? (
                        <option value="from">
                          {intl.formatMessage({
                            id: "entities.register.entry.from",
                            defaultMessage: "From",
                          })}
                        </option>
                      ) : null}
                      {sides.to !== false || kind === "conversion" ? (
                        <option value="to">
                          {kind === "conversion"
                            ? intl.formatMessage({
                                id: "entities.register.entry.toClass",
                                defaultMessage: "To class",
                              })
                            : intl.formatMessage({
                                id: "entities.register.entry.to",
                                defaultMessage: "To",
                              })}
                        </option>
                      ) : null}
                    </select>
                    <NumberInput
                      aria-label={intl.formatMessage({
                        id: "entities.register.entry.certificateShares",
                        defaultMessage: "Certificate shares",
                      })}
                      inputMode="numeric"
                      placeholder={intl.formatMessage({
                        id: "entities.register.entry.shares",
                        defaultMessage: "Shares",
                      })}
                      value={draft.quantity}
                      onValueChange={(value) =>
                        setIssued((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, quantity: value } : row,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={intl.formatMessage({
                        id: "entities.register.entry.distinctive",
                        defaultMessage: "Distinctive numbers",
                      })}
                      placeholder={intl.formatMessage({
                        id: "entities.register.entry.distinctiveShort",
                        defaultMessage: "Nos.",
                      })}
                      maxLength={200}
                      value={draft.distinctiveNumbers}
                      onChange={(event) =>
                        setIssued((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, distinctiveNumbers: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={intl.formatMessage({
                        id: "entities.register.entry.removeCertificate",
                        defaultMessage: "Remove certificate",
                      })}
                      onClick={() => setIssued((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setIssued((current) => [
                        ...current,
                        {
                          number: "",
                          holder: sides.to !== false && kind !== "conversion" ? "to" : "from",
                          quantity: "",
                          distinctiveNumbers: "",
                        },
                      ])
                    }
                  >
                    <Plus size={16} aria-hidden="true" />
                    <FormattedMessage
                      id="entities.register.entry.addCertificate"
                      defaultMessage="Issue certificate"
                    />
                  </Button>
                </div>
              </div>
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
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
