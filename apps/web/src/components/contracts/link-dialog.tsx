// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Link contract" dialog (M17/4, CTR-015): the actor picks a
 * contract by number or title, chooses a link type, and confirms.
 *
 * The same dialog serves both the "Add link" and the "Set parent"
 * acts. The `mode` prop decides the shape: `"link"` shows the
 * relation type selector; `"parent"` hides it and commits through
 * the parent write instead.
 *
 * **The CTR-018 nudge** appears after a link is created when exactly
 * one side is confidential. Accepting flags the other side by the
 * ordinary confidentiality PATCH; dismissing does nothing. It is a
 * suggestion, never enforcement, and unlinking never un-flags.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { contractReference, STAGE_PILL } from "../../lib/contracts";
import {
  addRelation,
  removeRelation,
  removeParent,
  searchLinkCandidates,
  setParent,
  type ContractRelations,
  type LinkCandidate,
  type RelationType,
} from "../../lib/relations";
import { api } from "../../lib/api";
import {
  CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
  CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
  CONTRACT_SELF_LINK_PROBLEM_TYPE,
} from "@openlaw/shared";

const MESSAGES = defineMessages({
  dialogTitle: {
    id: "contracts.relations.dialogTitle",
    defaultMessage: "Link contract",
  },
  parentDialogTitle: {
    id: "contracts.relations.parentDialogTitle",
    defaultMessage: "Set parent",
  },
  pickerPlaceholder: {
    id: "contracts.relations.pickerPlaceholder",
    defaultMessage: "Search by number or title…",
  },
  typeLabel: {
    id: "contracts.relations.typeLabel",
    defaultMessage: "Link type",
  },
  linkError: {
    id: "contracts.relations.linkError",
    defaultMessage: "Could not link these contracts.",
  },
  parentError: {
    id: "contracts.relations.parentError",
    defaultMessage: "Could not set the parent.",
  },
  duplicateError: {
    id: "contracts.relations.duplicateError",
    defaultMessage: "These two contracts are already linked that way.",
  },
  cycleError: {
    id: "contracts.relations.cycleError",
    defaultMessage: "That contract already sits under this one. Pick another parent.",
  },
  selfLinkError: {
    id: "contracts.relations.selfLinkError",
    defaultMessage: "A contract cannot be linked to itself.",
  },
  nudgeTitle: {
    id: "contracts.relations.nudge.title",
    defaultMessage: "Flag as confidential?",
  },
  nudgeBody: {
    id: "contracts.relations.nudge.body",
    defaultMessage:
      "{reference} is confidential but {otherReference} is not. Flag {otherReference} as confidential too?",
  },
  nudgeAccept: {
    id: "contracts.relations.nudge.accept",
    defaultMessage: "Flag as confidential",
  },
  nudgeDismiss: {
    id: "contracts.relations.nudge.dismiss",
    defaultMessage: "No, leave it open",
  },
});

const RELATION_TYPES: readonly RelationType[] = ["related", "renews", "amends"];

/** Translates a problem type URN into a user-facing message, or falls
 * back to the generic error. */
function refusalMessage(type: string | undefined, mode: "link" | "parent") {
  switch (type) {
    case CONTRACT_RELATION_EXISTS_PROBLEM_TYPE:
      return MESSAGES.duplicateError;
    case CONTRACT_PARENT_CYCLE_PROBLEM_TYPE:
      return MESSAGES.cycleError;
    case CONTRACT_SELF_LINK_PROBLEM_TYPE:
      return MESSAGES.selfLinkError;
    default:
      return mode === "parent" ? MESSAGES.parentError : MESSAGES.linkError;
  }
}

// ---------------------------------------------------------------------------
// Nudge dialog (CTR-018)
// ---------------------------------------------------------------------------

function ConfidentialityNudge({
  thisNumber,
  otherNumber,
  thisIsConfidential,
  onAccept,
  onDismiss,
  busy,
}: Readonly<{
  thisNumber: number;
  otherNumber: number;
  thisIsConfidential: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  busy: boolean;
}>) {
  const intl = useIntl();
  const confidentialRef = contractReference(intl, thisIsConfidential ? thisNumber : otherNumber);
  const openRef = contractReference(intl, thisIsConfidential ? otherNumber : thisNumber);

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogTitle>
          <FormattedMessage {...MESSAGES.nudgeTitle} />
        </DialogTitle>
        <p className="mt-2 text-sm text-secondary">
          <FormattedMessage
            {...MESSAGES.nudgeBody}
            values={{ reference: confidentialRef, otherReference: openRef }}
          />
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onDismiss} disabled={busy}>
            <FormattedMessage {...MESSAGES.nudgeDismiss} />
          </Button>
          <Button onClick={onAccept} disabled={busy}>
            <FormattedMessage {...MESSAGES.nudgeAccept} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

function CandidatePicker({
  contractNumber,
  selected,
  onSelect,
}: Readonly<{
  contractNumber: number;
  selected: LinkCandidate | null;
  onSelect: (candidate: LinkCandidate | null) => void;
}>) {
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(
    (q: string) => {
      if (q.trim().length === 0) {
        setCandidates([]);
        return;
      }
      void searchLinkCandidates(contractNumber, q).then(setCandidates);
    },
    [contractNumber],
  );

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length === 0) {
      setCandidates([]);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-button border border-border-default bg-raised px-3 py-1.5 text-sm">
        <span className="font-medium">{contractReference(intl, selected.number)}</span>
        <span className="truncate">{selected.title}</span>
        <button
          type="button"
          className="ml-auto text-xs text-link hover:underline"
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
        >
          {"×"}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        className="w-full rounded-button border border-border-default bg-raised px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-2 focus:outline-offset-2 focus:outline-link"
        aria-label={intl.formatMessage(MESSAGES.pickerPlaceholder)}
        placeholder={intl.formatMessage(MESSAGES.pickerPlaceholder)}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && candidates.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-card border border-border-default bg-raised shadow-md">
          {candidates.map((candidate) => (
            <li key={candidate.number}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-control"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(candidate);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="font-medium">{contractReference(intl, candidate.number)}</span>
                <span className="truncate">{candidate.title}</span>
                <span
                  className={`ml-auto inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[candidate.stage]}`}
                >
                  {candidate.statusName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function LinkDialog({
  contractNumber,
  contractIsConfidential,
  mode,
  onClose,
  onRelationsChanged,
}: Readonly<{
  contractNumber: number;
  contractIsConfidential: boolean;
  mode: "link" | "parent";
  onClose: () => void;
  onRelationsChanged: (relations: ContractRelations) => void;
}>) {
  const intl = useIntl();
  const [selected, setSelected] = useState<LinkCandidate | null>(null);
  const [relationType, setRelationType] = useState<RelationType>("related");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState<{
    thisNumber: number;
    otherNumber: number;
    thisIsConfidential: boolean;
    relations: ContractRelations;
  } | null>(null);

  const submit = async () => {
    if (!selected) return;

    setBusy(true);
    setError(null);

    const result =
      mode === "parent"
        ? await setParent(contractNumber, selected.number)
        : await addRelation(contractNumber, selected.number, relationType);

    setBusy(false);

    if (!result.ok) {
      setError(intl.formatMessage(refusalMessage(result.type, mode)));
      return;
    }

    // CTR-018 nudge: if exactly one side is confidential, ask once.
    const thisConfidential = contractIsConfidential;
    const otherConfidential = selected.isConfidential;
    if (thisConfidential !== otherConfidential) {
      setNudge({
        thisNumber: contractNumber,
        otherNumber: selected.number,
        thisIsConfidential: thisConfidential,
        relations: result.relations,
      });
    } else {
      onRelationsChanged(result.relations);
      onClose();
    }
  };

  const handleNudgeAccept = async () => {
    if (!nudge) return;
    setBusy(true);

    // The open side is the one that is not confidential. Flag it.
    const openNumber = nudge.thisIsConfidential ? nudge.otherNumber : nudge.thisNumber;
    await api.PATCH("/api/v1/contracts/{number}", {
      params: { path: { number: openNumber } },
      body: { isConfidential: true },
    });

    setBusy(false);
    onRelationsChanged(nudge.relations);
    onClose();
  };

  const handleNudgeDismiss = () => {
    if (!nudge) return;
    onRelationsChanged(nudge.relations);
    onClose();
  };

  if (nudge) {
    return (
      <ConfidentialityNudge
        thisNumber={nudge.thisNumber}
        otherNumber={nudge.otherNumber}
        thisIsConfidential={nudge.thisIsConfidential}
        onAccept={() => void handleNudgeAccept()}
        onDismiss={handleNudgeDismiss}
        busy={busy}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>
          <FormattedMessage
            {...(mode === "parent" ? MESSAGES.parentDialogTitle : MESSAGES.dialogTitle)}
          />
        </DialogTitle>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="mt-4 flex flex-col gap-4">
            <CandidatePicker
              contractNumber={contractNumber}
              selected={selected}
              onSelect={setSelected}
            />
            {mode === "link" && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-subtle">
                  <FormattedMessage {...MESSAGES.typeLabel} />
                </label>
                <select
                  className="w-full rounded-button border border-border-default bg-raised px-3 py-1.5 text-sm text-primary focus:outline-2 focus:outline-offset-2 focus:outline-link"
                  value={relationType}
                  onChange={(event) => setRelationType(event.target.value as RelationType)}
                >
                  {RELATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === "related"
                        ? intl.formatMessage({ id: "contracts.relations.relatedLabel", defaultMessage: "Related" })
                        : type === "renews"
                          ? intl.formatMessage({ id: "contracts.relations.renewsLabel", defaultMessage: "Renews" })
                          : intl.formatMessage({ id: "contracts.relations.amendsLabel", defaultMessage: "Amends" })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-status-danger-fg">
                {error}
              </p>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy || !selected}>
              <FormattedMessage
                {...(mode === "parent" ? MESSAGES.parentDialogTitle : MESSAGES.dialogTitle)}
              />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
