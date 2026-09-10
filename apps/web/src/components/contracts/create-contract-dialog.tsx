// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The create-contract dialog (M8), drawn from `S10 Overlay` in the C10
 * frame of `designs/contracts.pen`.
 *
 * **One form for every way a Contract is born**: the Contracts list,
 * the Matter's Linked Contracts, and a routed renewal all open this
 * dialog. Routing a renewal makes an ordinary Contract, and a create
 * form that behaved differently for renewals would be a second set of
 * rules to keep in step with this one.
 *
 * **The picked Contract Type brings all its Fields** (CTR-016 UX
 * addendum, 2026-09-08). Every attached Field is drawn as soon as a
 * Type is picked; only the required ones carry a star and block
 * creation when unanswered. Drafts survive switching Type and back, and
 * only the picked Type's Fields are submitted.
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
 *
 * **The Owner is seeded with the person opening the dialog** (CTR-004
 * focus-group addendum, 2026-09-09). Four testers found their own new
 * record Unassigned. Opening this dialog is taking the work on, so the
 * picker starts on the acting person when they are Member+, and they
 * can clear it to Unassigned before pressing Create. A routed renewal
 * gets the same seed: it is the router's record, never the predecessor's
 * Owner copied across.
 */

import { CreateAttachments, useCreateAttachments } from "../documents/create-attachments";
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import {
  contractReference,
  type ContractRow,
  type ContractTypeOption,
  type UserOption,
} from "../../lib/contracts";
import {
  searchCreateMatterCandidates,
  type CreateMatterLinkCandidate,
} from "../../lib/contract-matters";
import {
  emptyDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../../lib/custom-fields";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problem as readProblem } from "../../lib/problem";
import { matterReference } from "../../lib/matters";
import { isMemberPlus } from "../../lib/roles";
import { ConfidentialToggle } from "../confidential-toggle";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const MATTER_SEARCH_DEBOUNCE_MS = 200;

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
  users,
  entities,
  viewerId,
  renewalOf,
  initialMatter,
  onOpenChange,
  onCreated,
}: Readonly<{
  contractTypes: ContractTypeOption[];
  /** The Member+ picker roster. A `user` field offers everyone on it;
   * the Owner picker offers only the Member+ people (CTR-004). */
  users: readonly UserOption[];
  /** Choices for an `entity` field — the M7 registry. */
  entities: readonly FieldReference[];
  /** Who opened the dialog. Seeded as the Owner when eligible. */
  viewerId: string;
  /** The renewal this create is routing, or undefined for the ordinary
   * create the Contracts list opens. */
  renewalOf?: RenewalPrefill;
  initialMatter?: Pick<CreateMatterLinkCandidate, "number" | "title" | "isConfidential">;
  onOpenChange: (open: boolean) => void;
  onCreated: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  const attachments = useCreateAttachments();
  // Seeded once, as the initial value rather than as an effect: the
  // person may edit either box, and a prefill that re-applied itself
  // would take their edit back.
  const [title, setTitle] = useState(renewalOf?.title ?? "");
  const [contractTypeId, setContractTypeId] = useState(renewalOf?.contractTypeId ?? "");
  const people: FieldReference[] = users.map((person) => ({
    id: person.id,
    label: person.displayName,
    archived: person.archived,
  }));
  const owners = users.filter((person) => isMemberPlus(person.role));
  /** The Owner (CTR-004). Seeded once, like the title: the person may
   * clear it, and a seed that re-applied itself would put them back. */
  const [managerId, setManagerId] = useState(
    owners.some((person) => person.id === viewerId) ? viewerId : "",
  );
  /** The fields' drafts, keyed by slug. They survive switching
   * types and back — a name typed once should not have to be typed
   * again because someone checked another type on the way. */
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, CustomFieldDraft>>({});
  /** DD-014's flag, set here so a sensitive record is never visible to
   * the wrong audience, even briefly. The actor is the creator by
   * definition, so no gate is needed: whoever may create may flag. */
  const [confidential, setConfidential] = useState(false);
  const [matterQuery, setMatterQuery] = useState("");
  const [matterCandidates, setMatterCandidates] = useState<CreateMatterLinkCandidate[]>([]);
  const [selectedMatter, setSelectedMatter] = useState<Pick<
    CreateMatterLinkCandidate,
    "number" | "title" | "isConfidential"
  > | null>(initialMatter ?? null);
  const [matterSearching, setMatterSearching] = useState(false);
  const [matterSearchError, setMatterSearchError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields =
    contractTypes.find((contractType) => contractType.id === contractTypeId)?.fields ?? [];

  const trimmedMatterQuery = matterQuery.trim();
  useEffect(() => {
    if (trimmedMatterQuery === "" || selectedMatter) return;
    let live = true;
    const timer = setTimeout(() => {
      void searchCreateMatterCandidates(trimmedMatterQuery)
        .then((rows) => {
          if (!live) return;
          setMatterCandidates(rows);
          setMatterSearching(false);
        })
        .catch(() => {
          if (!live) return;
          setMatterCandidates([]);
          setMatterSearching(false);
          setMatterSearchError(true);
        });
    }, MATTER_SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selectedMatter, trimmedMatterQuery]);

  async function submit() {
    if (busy || attachments.created) return;
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
    for (const field of fields) {
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
      if (field.isRequired && parsed.value === null) {
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
      if (parsed.value !== null) customFields[field.slug] = parsed.value;
    }
    setBusy(true);
    const body = {
      title: title.trim(),
      contractTypeId,
      customFields,
      isConfidential: confidential,
      // Unassigned is null, a real state (CTR-004), not an omitted key.
      managerId: managerId || null,
      ...(selectedMatter ? { matterNumber: selectedMatter.number } : {}),
      // The routing, if this create is one. The seam does the rest
      // of the copying and writes the link; nothing here derives
      // either, so the dialog cannot disagree with the record about
      // what a renewal inherits.
      ...(renewalOf ? { renewalOf: { number: renewalOf.number, vehicle: renewalOf.vehicle } } : {}),
    };
    const result = await api.POST("/api/v1/contracts", { body }).catch(() => undefined);
    const { data } = result ?? {};
    setBusy(false);
    if (!data) {
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "contracts.form.createError",
            defaultMessage: "The contract could not be created.",
          }),
      );
      return;
    }
    await attachments.upload({ entityType: "contract", number: data.contract.number }, () => {
      onCreated(data.contract);
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (busy || attachments.pending) return;
        if (attachments.created) attachments.finish();
        else onOpenChange(open);
      }}
    >
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
        {attachments.created ? (
          <div className="mt-4">
            <CreateAttachments uploads={attachments} />
          </div>
        ) : (
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
              <Label htmlFor="contract-new-title" required>
                <FormattedMessage id="contracts.form.titleField" defaultMessage="Title" />
              </Label>
              <Input
                id="contract-new-title"
                aria-required="true"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-new-matter">
                <FormattedMessage id="contracts.form.matter" defaultMessage="Matter" />
              </Label>
              <Input
                id="contract-new-matter"
                aria-describedby="contract-new-matter-help"
                value={
                  selectedMatter
                    ? `${matterReference(intl, selectedMatter.number)} ${selectedMatter.title}`
                    : matterQuery
                }
                placeholder={intl.formatMessage({
                  id: "contracts.form.matterPlaceholder",
                  defaultMessage: "Search by number or title; leave blank for standalone",
                })}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedMatter(null);
                  setMatterQuery(next);
                  setMatterCandidates([]);
                  setMatterSearching(next.trim() !== "");
                  setMatterSearchError(false);
                  setError(null);
                }}
              />
              {!selectedMatter && trimmedMatterQuery !== "" && (
                <ul
                  className="max-h-40 overflow-y-auto rounded-md border border-border"
                  aria-label={intl.formatMessage({
                    id: "contracts.form.matterMatches",
                    defaultMessage: "Matter matches",
                  })}
                >
                  {matterSearching ? (
                    <li className="p-3 text-sm text-muted">
                      <FormattedMessage id="contractMatter.searching" defaultMessage="Searching…" />
                    </li>
                  ) : matterCandidates.length === 0 ? (
                    <li className="p-3 text-sm text-muted">
                      <FormattedMessage
                        id="contractMatter.noMatches"
                        defaultMessage="No eligible records found."
                      />
                    </li>
                  ) : (
                    matterCandidates.map((matter) => (
                      <li key={matter.number}>
                        <button
                          type="button"
                          className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-link"
                          onClick={() => {
                            setSelectedMatter(matter);
                            setMatterSearching(false);
                          }}
                        >
                          <span className="font-medium">
                            {matterReference(intl, matter.number)}
                          </span>{" "}
                          <span className="min-w-0 break-words">{matter.title}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
              {matterSearchError && (
                <p className="text-xs text-status-danger-fg">
                  <FormattedMessage
                    id="contracts.form.matterSearchError"
                    defaultMessage="Eligible Matters could not be searched."
                  />
                </p>
              )}
              <p id="contract-new-matter-help" className="text-xs text-muted">
                <FormattedMessage
                  id="contracts.form.matterHelp"
                  defaultMessage="Link only when this Contract is part of broader Matter work. Nothing else flows across the link."
                />
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-new-type" required>
                <FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />
              </Label>
              <select
                id="contract-new-type"
                aria-required="true"
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-new-owner">
                <FormattedMessage id="contracts.form.owner" defaultMessage="Owner" />
              </Label>
              <select
                id="contract-new-owner"
                className={CONTROL_CLASS}
                value={managerId}
                onChange={(event) => setManagerId(event.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "contracts.ownerUnassigned",
                    defaultMessage: "Unassigned",
                  })}
                </option>
                {owners.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            </div>
            {fields.map((field) => (
              <div key={field.slug} className="flex flex-col gap-1.5">
                <Label
                  id={`contract-new-${field.slug}-label`}
                  htmlFor={`contract-new-${field.slug}`}
                  required={field.isRequired}
                >
                  {field.displayName}
                </Label>
                <CustomFieldControl
                  id={`contract-new-${field.slug}`}
                  field={field}
                  required={field.isRequired}
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
            {selectedMatter && selectedMatter.isConfidential !== confidential && (
              <p className="text-xs text-status-warning-fg">
                <FormattedMessage
                  id="contracts.form.matterMismatch"
                  defaultMessage="This Contract and Matter will have different Confidential flags. Consider aligning them later if appropriate; creation changes neither flag automatically."
                />
              </p>
            )}
            <CreateAttachments uploads={attachments} disabled={busy} />
            {error && (
              <p role="alert" className="text-xs text-status-danger-fg">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="contracts.form.submit" defaultMessage="Create" />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
