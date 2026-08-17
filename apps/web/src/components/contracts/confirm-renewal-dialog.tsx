// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-043 and DES-044: the Renew dialog, drawn from `S9 Overlay` in the
 * C9 frame of `designs/contracts.pen` — the compound edit DES-017 carves
 * out of the inline-commit rule, because a roll is a date **and** the
 * assertion that the term rolled, and the two commit together.
 *
 * **The mock's four vehicles are all here now** (M16/5, CTR-007).
 * DES-043 clause 8 left the radio list out while three of the four could
 * not be picked; DES-044 puts it back, one option per vehicle, with the
 * mock's own titles and sentences.
 *
 * **One of the four commits and three of them route.** Confirming the
 * roll writes here — the record's own expiry advances. Papering the
 * renewal as an amendment hands the person to the record's Documents
 * section with the version composer open on the primary chain; a child
 * contract and a standalone successor hand them to the create dialog,
 * prefilled. So the button is the chosen vehicle's own verb, and the
 * foot note says what that vehicle does rather than what the dialog
 * does.
 *
 * **The proposal is the seam's and the commitment is the person's.**
 * The record answers where a roll would land (the current expiry plus
 * the renewal period, month arithmetic and all) and the box is seeded
 * with it. The person may put a different date in before pressing,
 * because a roll whose dates shifted in negotiation is recorded as it
 * really landed (CTR-007). Nothing here recomputes the proposal:
 * DES-040 clause 4's rule, applied to a date instead of a count.
 *
 * **The confirm carries the expiry it was raised against.** That is the
 * saved value and never the draft — the seam compares it under the
 * contract's row lock, which is what makes two people confirming one
 * roll advance the term exactly once.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CirclePlus, FilePlus2, History, Network, RotateCw } from "lucide-react";
import { formatShortDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** The error line's id, named on the box the message is about so a
 * screen reader reads the two together (DES-011). */
const ERROR_ID = "confirm-renewal-error";

/**
 * CTR-007's four vehicles, in the order the C9 mock lists them.
 *
 * `roll` is first and is the default, because it is the one an
 * auto-renewing contract most often takes and the only one that records
 * the renewal here rather than somewhere else.
 */
export const RENEWAL_VEHICLES = ["roll", "amendment", "child", "successor"] as const;
export type RenewalVehicle = (typeof RENEWAL_VEHICLES)[number];

/** Each vehicle's own glyph, so the list reads at a glance (DES-008). */
const VEHICLE_ICON = {
  roll: RotateCw,
  amendment: FilePlus2,
  child: Network,
  successor: CirclePlus,
} as const;

export function ConfirmRenewalDialog({
  reference,
  fromExpiry,
  proposedExpiry,
  renewalPeriodMonths,
  canAmend,
  busy,
  onClose,
  onConfirm,
  onRoute,
}: Readonly<{
  /** The record's CTR-003 reference, as the mock's own sentence names
   * it — "C-51 auto-renews in 12-month periods". */
  reference: string;
  /** The expiry the record holds now: what the roll advances from, and
   * the precondition the confirm carries. */
  fromExpiry: string;
  /** Where the record says a roll would land, or null when it records
   * no renewal period to add. The box is seeded with it. */
  proposedExpiry: string | null;
  /** How far one roll advances the term, or null when nobody recorded
   * it. Only the dialog's opening sentence reads it. */
  renewalPeriodMonths: number | null;
  /** Whether this record has a primary document to file an amendment
   * on. False leaves the amendment option out entirely — DES-035 clause
   * 9's absence rule: a chain that does not exist has nothing to
   * append. */
  canAmend: boolean;
  busy: boolean;
  onClose: () => void;
  /** Answers the refusal to print, or null when the roll landed. */
  onConfirm: (toExpiry: string) => Promise<string | null>;
  /** Hands the person to the surface the chosen vehicle is taken on.
   * The act happens elsewhere, so the caller closes this dialog as it
   * routes: a dialog left open over the surface it just opened would be
   * a second thing to dismiss. */
  onRoute: (vehicle: Exclude<RenewalVehicle, "roll">) => void;
}>) {
  const intl = useIntl();
  const [vehicle, setVehicle] = useState<RenewalVehicle>("roll");
  const [draft, setDraft] = useState(proposedExpiry ?? "");
  /** What is wrong, and whether it is about the box. A refusal the seam
   * gave belongs to no control — it is about the write — so only the
   * two the form itself checks mark the input, which is the shape the
   * key-date dialog already uses. */
  const [error, setError] = useState<{ onBox: boolean; message: string } | null>(null);

  const refuse = (message: string) => setError({ onBox: true, message });

  /** The vehicles this record can actually take. */
  const offered = RENEWAL_VEHICLES.filter((option) => option !== "amendment" || canAmend);

  async function submit() {
    if (busy) return;
    // Three of the four vehicles are taken somewhere else. The dialog
    // hands the person over and closes; nothing is written here, so
    // there is nothing to validate and nothing to refuse.
    if (vehicle !== "roll") {
      onRoute(vehicle);
      return;
    }
    // The two refusals the seam gives, said here first so the reader is
    // not asked to press a button to find out that the box is empty or
    // that the date goes the wrong way. Everything else is the seam's
    // to refuse — one copy of a rule (DES-035 clause 12).
    if (draft === "") {
      refuse(
        intl.formatMessage({
          id: "renewal.needExpiry",
          defaultMessage: "Pick the date the term now runs to.",
        }),
      );
      return;
    }
    if (draft <= fromExpiry) {
      refuse(
        intl.formatMessage({
          id: "renewal.mustAdvance",
          defaultMessage: "A roll moves the term forward. Pick a date after the current expiry.",
        }),
      );
      return;
    }
    const refusal = await onConfirm(draft);
    setError(refusal === null ? null : { onBox: false, message: refusal });
  }

  /** Each vehicle's name, in the mock's own words. */
  function vehicleTitle(option: RenewalVehicle) {
    switch (option) {
      case "roll":
        return intl.formatMessage({
          id: "renewal.vehicle.roll",
          defaultMessage: "Confirm the roll",
        });
      case "amendment":
        return intl.formatMessage({
          id: "renewal.vehicle.amendment",
          defaultMessage: "Paper as amendment",
        });
      case "child":
        return intl.formatMessage({
          id: "renewal.vehicle.child",
          defaultMessage: "Create child contract",
        });
      case "successor":
        return intl.formatMessage({
          id: "renewal.vehicle.successor",
          defaultMessage: "New successor contract",
        });
    }
  }

  /** What each vehicle does to the record, in the mock's own words. */
  function vehicleBlurb(option: RenewalVehicle) {
    switch (option) {
      case "roll":
        return intl.formatMessage({
          id: "renewal.vehicle.rollBlurb",
          defaultMessage: "Same record — the expiry advances.",
        });
      case "amendment":
        return intl.formatMessage({
          id: "renewal.vehicle.amendmentBlurb",
          defaultMessage: "Renewal recorded as an amendment on this contract's paper.",
        });
      case "child":
        return intl.formatMessage({
          id: "renewal.vehicle.childBlurb",
          defaultMessage: "New record parented to this one.",
        });
      case "successor":
        return intl.formatMessage({
          id: "renewal.vehicle.successorBlurb",
          defaultMessage: "Standalone record linked as the renewal.",
        });
    }
  }

  /** The button's verb — what pressing it does next. */
  function vehicleAction(option: RenewalVehicle) {
    switch (option) {
      case "roll":
        return intl.formatMessage({
          id: "renewal.confirm",
          defaultMessage: "Confirm renewal",
        });
      case "amendment":
        return intl.formatMessage({
          id: "renewal.action.amendment",
          defaultMessage: "File the amendment",
        });
      case "child":
        return intl.formatMessage({
          id: "renewal.action.child",
          defaultMessage: "Open the child contract",
        });
      case "successor":
        return intl.formatMessage({
          id: "renewal.action.successor",
          defaultMessage: "Open the successor",
        });
    }
  }

  /** The foot note, which says what the chosen vehicle leaves behind. */
  function vehicleNote(option: RenewalVehicle) {
    switch (option) {
      case "roll":
        return (
          <FormattedMessage
            id="renewal.recordedNote"
            defaultMessage="Recorded on the record's activity. The contract's status and stage do not change."
          />
        );
      case "amendment":
        return (
          <FormattedMessage
            id="renewal.note.amendment"
            defaultMessage="Opens this record's Documents section to file an amendment on its paper. No new record is made."
          />
        );
      case "child":
        return (
          <FormattedMessage
            id="renewal.note.child"
            defaultMessage="Opens a new contract prefilled from this one, born under it. The team, the status, and the Confidential flag are not carried over."
          />
        );
      case "successor":
        return (
          <FormattedMessage
            id="renewal.note.successor"
            defaultMessage="Opens a new contract prefilled from this one, linked as its renewal. The team, the status, and the Confidential flag are not carried over."
          />
        );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="renewal.title" defaultMessage="Confirm renewal" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* The mock's opening sentence. It says what the record is and
              asks the question the list below answers — how this renewal
              should be recorded — rather than describing one vehicle,
              now that four of them are on offer. */}
          <p className="text-sm text-muted">
            {renewalPeriodMonths === null ? (
              <FormattedMessage
                id="renewal.introNoPeriod"
                defaultMessage="{reference} auto-renews, and records no renewal period. Choose how to record the new term."
                values={{ reference }}
              />
            ) : (
              <FormattedMessage
                id="renewal.intro"
                defaultMessage="{reference} auto-renews in {months, plural, one {#-month} other {#-month}} periods. Choose how to record the new term."
                values={{ reference, months: renewalPeriodMonths }}
              />
            )}
          </p>
          {/* CTR-007's four vehicles, as the mock's radio list. A radio
              group rather than four buttons: picking one is a choice
              about what to record, and the choice is made before the
              act — so the reader sees all four at once and the group
              answers to the arrow keys. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">
              <FormattedMessage id="renewal.vehicle.legend" defaultMessage="How to record it" />
            </legend>
            {offered.map((option) => {
              const Glyph = VEHICLE_ICON[option];
              const chosen = option === vehicle;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-button border p-3",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1",
                    "has-[:focus-visible]:outline-link",
                    chosen
                      ? "border-status-info-fg bg-status-info-bg"
                      : "border-border-default bg-raised",
                  )}
                >
                  <input
                    type="radio"
                    name="renewal-vehicle"
                    className="sr-only"
                    value={option}
                    checked={chosen}
                    onChange={() => {
                      setVehicle(option);
                      setError(null);
                    }}
                  />
                  <Glyph
                    size={16}
                    aria-hidden="true"
                    className={`mt-px shrink-0 ${chosen ? "text-status-info-fg" : "text-muted"}`}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm">{vehicleTitle(option)}</span>
                    <span className="text-xs text-muted">{vehicleBlurb(option)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {/* The roll's own field, drawn only when the roll is chosen:
              the other three vehicles record their new term on the
              record they are about to open, not here. It takes no focus
              on mount — the radio group above it mounts and unmounts it,
              and a box that grabbed focus would take it off the group
              the moment somebody arrowed back onto the roll. The dialog
              puts focus where it opens. */}
          {vehicle === "roll" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="renewal-expiry">
                <FormattedMessage id="renewal.field.expiry" defaultMessage="New expiry date" />
              </Label>
              <Input
                id="renewal-expiry"
                type="date"
                value={draft}
                {...(error?.onBox ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {})}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
              />
              {/* What the term runs to now, so the person can see what
                  they are moving from without leaving the dialog. */}
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="renewal.currentExpiry"
                  defaultMessage="The term currently runs to {date}."
                  values={{ date: formatShortDate(fromExpiry, { locale: intl.locale }) }}
                />
              </p>
            </div>
          )}
          {/* What the act does, said where the act is taken (DES-035
              clause 17). Both halves are facts somebody hesitating
              wants: it is on the record for good, and it moves a date
              rather than the contract's lifecycle. The mock's second
              sentence — that reminders stop — describes M18's delivery
              and is withheld until that slice exists. The three routed
              vehicles say where they are about to take the reader,
              because a button that navigates should say so first. */}
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" className="mt-px shrink-0" />
            {vehicleNote(vehicle)}
          </p>
          {error !== null && (
            <p id={ERROR_ID} role="alert" className="text-xs text-status-danger-fg">
              {error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            {/* The verb rather than "Save" (DES-035 clause 10): a roll
                asserts that a term renewed, and an assertion should not
                be pressed by reflex. The verb follows the vehicle, so a
                button that is about to open a create dialog does not
                say "Confirm renewal". The primary button rather than the
                danger one — a renewal is a normal act, and red would
                say a mistake was being made. */}
            <Button type="submit" disabled={busy}>
              {vehicleAction(vehicle)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
