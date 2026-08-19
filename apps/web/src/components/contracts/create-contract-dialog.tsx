// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The create-contract dialog (M8), drawn from `S10 Overlay` in the C10
 * frame of `designs/contracts.pen`.
 *
 * **Creation is deliberately minimal**: a title, a type, and whatever
 * that type hard-requires (CTR-016/MTR-014 — the dialog grows the
 * required fields as soon as a type is picked, so a contract cannot be
 * born missing data its type demands). The status starts on the
 * protected draft seed, and everything else is set inline on the record
 * afterward (DES-017).
 *
 * **It is also the flow a routed renewal opens** (M16/5, CTR-007,
 * DES-044). The Renew dialog's child and successor vehicles open this
 * same dialog rather than a second create surface: routing a renewal
 * makes an ordinary contract, and a create form that behaved differently
 * for renewals would be a second set of rules to keep in step with this
 * one.
 *
 * **Two things are prefilled here and the rest are prefilled at the
 * seam.** This dialog draws the title and the type, so those two are
 * seeded from the record the renewal was routed from and stay editable
 * until the button is pressed — whatever is in the boxes is what the
 * record is born with. The business facts this dialog does not draw —
 * our entity, the value, the term shape, the counterparties — are copied
 * by the create seam, because it is the one place that can copy them and
 * the one place worth asserting them at. The team, the status, and the
 * Confidential flag are never copied at all (CTR-015).
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { contractReference, type ContractRow, type ContractTypeOption } from "../../lib/contracts";
import {
  emptyDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../../lib/custom-fields";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problemDetail } from "../../lib/messages";
import { ConfidentialToggle } from "../confidential-toggle";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/**
 * What a routed renewal seeds the two drawn fields with, and which
 * record it is being routed from (CTR-007, M16/5).
 *
 * The whole prefill is one object rather than two loose props, because
 * the two halves are one act: a dialog that carried a predecessor but no
 * seeded title, or the other way round, would be a state this flow does
 * not have.
 */
export interface RenewalPrefill {
  /** The predecessor's CTR-003 number — what the seam copies from. */
  number: number;
  vehicle: "child" | "successor";
  /** The predecessor's title, seeded into the box and editable. */
  title: string;
  /** The predecessor's type, seeded into the picker and editable. */
  contractTypeId: string;
}

export function CreateContractDialog({
  contractTypes,
  people,
  entities,
  renewalOf,
  onOpenChange,
  onCreated,
}: Readonly<{
  contractTypes: ContractTypeOption[];
  /** What a required `user` field offers. */
  people: readonly FieldReference[];
  /** What a required `entity` field offers — the M7 registry. */
  entities: readonly FieldReference[];
  /** The renewal this create is routing, or undefined for the ordinary
   * create the Contracts list opens. */
  renewalOf?: RenewalPrefill;
  onOpenChange: (open: boolean) => void;
  onCreated: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  // Seeded once, as the initial value rather than as an effect: the
  // person may edit either box, and a prefill that re-applied itself
  // would take their edit back.
  const [title, setTitle] = useState(renewalOf?.title ?? "");
  const [contractTypeId, setContractTypeId] = useState(renewalOf?.contractTypeId ?? "");
  /** The required fields' drafts, keyed by slug. They survive switching
   * types and back — a name typed once should not have to be typed
   * again because someone checked another type on the way. */
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, CustomFieldDraft>>({});
  /** DD-014's flag, set here so a sensitive record is never visible to
   * the wrong audience, even briefly. The actor is the creator by
   * definition, so no gate is needed: whoever may create may flag. */
  const [confidential, setConfidential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What the picked type demands. Nothing until a type is picked —
   * the dialog cannot ask for a type's fields before it has a type. */
  const required =
    contractTypes
      .find((contractType) => contractType.id === contractTypeId)
      ?.fields.filter((field) => field.isRequired) ?? [];

  async function submit() {
    if (busy) return;
    setError(null);
    if (title.trim() === "") {
      setError(
        intl.formatMessage({
          id: "contracts.form.titleMissing",
          defaultMessage: "Name the contract.",
        }),
      );
      return;
    }
    if (contractTypeId === "") {
      setError(
        intl.formatMessage({
          id: "contracts.form.typeMissing",
          defaultMessage: "Pick a contract type.",
        }),
      );
      return;
    }
    // The type's own demands, checked where the person can answer them.
    // The seam refuses an empty one too — this only saves a round trip.
    const customFields: Record<string, CustomFieldValue> = {};
    for (const field of required) {
      const parsed = toValue(field, fieldDrafts[field.slug] ?? emptyDraft(field));
      if ("error" in parsed) {
        setError(
          intl.formatMessage(
            {
              id: "contracts.field.numberInvalidNamed",
              defaultMessage: "{fieldName}: enter this as a number.",
            },
            { fieldName: field.displayName },
          ),
        );
        return;
      }
      if (parsed.value === null) {
        setError(
          intl.formatMessage(
            {
              id: "contracts.form.fieldMissing",
              defaultMessage: "Fill {field} — this contract type requires it.",
            },
            { field: field.displayName },
          ),
        );
        return;
      }
      customFields[field.slug] = parsed.value;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/contracts", {
        body: {
          title: title.trim(),
          contractTypeId,
          customFields,
          isConfidential: confidential,
          // The routing, if this create is one. The seam does the rest
          // of the copying and writes the link; nothing here derives
          // either, so the dialog cannot disagree with the record about
          // what a renewal inherits.
          ...(renewalOf
            ? { renewalOf: { number: renewalOf.number, vehicle: renewalOf.vehicle } }
            : {}),
        },
      })
      .catch(() => ({ data: null, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.form.createError",
            defaultMessage: "The contract could not be created.",
          }),
      );
      return;
    }
    onCreated(data.contract);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {/* The title says which of the two acts this is. A routed
            renewal is still an ordinary create, but a dialog that opened
            with boxes already filled and said only "Create contract"
            would leave the reader working out where the words came
            from. */}
        <DialogTitle>
          {renewalOf === undefined ? (
            <FormattedMessage id="contracts.form.title" defaultMessage="Create contract" />
          ) : renewalOf.vehicle === "child" ? (
            <FormattedMessage
              id="contracts.form.titleChild"
              defaultMessage="Create child contract"
            />
          ) : (
            <FormattedMessage
              id="contracts.form.titleSuccessor"
              defaultMessage="Create successor contract"
            />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* What was copied and what was not, said before the boxes it
              is about (DES-044). CTR-015's no-inheritance stance is
              invisible in a form whose fields are already full, so the
              dialog says it rather than letting the reader discover it
              on the record afterwards. */}
          {renewalOf !== undefined && (
            <p className="text-sm text-muted">
              {renewalOf.vehicle === "child" ? (
                <FormattedMessage
                  id="contracts.form.prefillChild"
                  defaultMessage="Prefilled from {reference} and born under it. The counterparties, our entity, the value, and the term came across; the team, the status, and the Confidential flag did not. Edit anything before you create it."
                  values={{ reference: contractReference(intl, renewalOf.number) }}
                />
              ) : (
                <FormattedMessage
                  id="contracts.form.prefillSuccessor"
                  defaultMessage="Prefilled from {reference} and linked as its renewal. The counterparties, our entity, the value, and the term came across; the team, the status, and the Confidential flag did not. Edit anything before you create it."
                  values={{ reference: contractReference(intl, renewalOf.number) }}
                />
              )}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-new-title">
              <FormattedMessage id="contracts.form.titleField" defaultMessage="Title" />
            </Label>
            <Input
              id="contract-new-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-new-type">
              <FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />
            </Label>
            <select
              id="contract-new-type"
              value={contractTypeId}
              className={CONTROL_CLASS}
              onChange={(event) => {
                setContractTypeId(event.target.value);
                // Picking a type answers the pick-a-type refusal.
                if (event.target.value !== "") setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({
                  id: "contracts.form.typePlaceholder",
                  defaultMessage: "Type…",
                })}
              </option>
              {contractTypes.map((contractType) => (
                <option key={contractType.id} value={contractType.id}>
                  {contractType.displayName}
                </option>
              ))}
            </select>
          </div>
          {/* The type's hard-required fields, grown into the dialog the
              moment a type is picked (CTR-016/MTR-014). The optional
              ones are not here: they are set inline on the record, and
              creation stays the smallest thing that makes a record. */}
          {required.map((field) => (
            <div key={field.slug} className="flex flex-col gap-1.5">
              <Label id={`contract-new-${field.slug}-label`} htmlFor={`contract-new-${field.slug}`}>
                {field.displayName}
                <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                  *
                </span>
                <span className="sr-only">
                  <FormattedMessage id="contracts.field.requiredMark" defaultMessage="(required)" />
                </span>
              </Label>
              <CustomFieldControl
                id={`contract-new-${field.slug}`}
                field={field}
                draft={fieldDrafts[field.slug] ?? emptyDraft(field)}
                people={people}
                entities={entities}
                describedBy={field.description ? `contract-new-${field.slug}-help` : undefined}
                onDraft={(next) => {
                  setFieldDrafts((current) => ({ ...current, [field.slug]: next }));
                  setError(null);
                }}
              />
              {field.description && (
                <p id={`contract-new-${field.slug}-help`} className="text-xs text-muted">
                  {field.description}
                </p>
              )}
            </div>
          ))}
          {/* DD-014's flag, where the C10 mock draws it: the last row
              before the note, so the audience is decided before the
              record exists rather than in the seconds after. */}
          <ConfidentialToggle
            id="contract-new-confidential"
            confidential={confidential}
            onChange={setConfidential}
          />
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="contracts.form.submit" defaultMessage="Create" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
