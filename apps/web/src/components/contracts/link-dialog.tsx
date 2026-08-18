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
 *
 * **The picker is a combobox** on the WAI-ARIA pattern, as the
 * counterparty and timezone pickers already are (DES-024): shadcn's
 * combobox brings cmdk, a dependency DES-004 does not admit, and Radix
 * has no combobox primitive. Typing searches, Arrow keys walk the
 * candidates, Enter commits the active one, Escape closes the list —
 * and only the list, because the dialog around it is what Escape would
 * otherwise take.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { cn } from "../../lib/utils";
import { contractReference, STAGE_PILL } from "../../lib/contracts";
import {
  addRelation,
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
  nudgeError: {
    id: "contracts.relations.nudge.error",
    defaultMessage: "Could not flag {reference} as confidential.",
  },
  clearSelection: {
    id: "contracts.relations.clearSelection",
    defaultMessage: "Clear the picked contract",
  },
  // Not "Contracts": the box above this list is already named for what
  // it searches, and two things named the same is a reader having to
  // work out which one they landed on.
  pickerListLabel: {
    id: "contracts.relations.pickerListLabel",
    defaultMessage: "Contract matches",
  },
  pickerSearching: {
    id: "contracts.relations.pickerSearching",
    defaultMessage: "Searching…",
  },
  pickerNoMatches: {
    id: "contracts.relations.pickerNoMatches",
    defaultMessage: "No contracts to link.",
  },
});

/**
 * How long a pause in typing means "search now". Short enough that the
 * list feels like it is keeping up, long enough that typing a title
 * straight through is one request and not fifteen.
 */
const SEARCH_DEBOUNCE_MS = 200;

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
  error,
}: Readonly<{
  thisNumber: number;
  otherNumber: number;
  thisIsConfidential: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  busy: boolean;
  error: string | null;
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
        {error && (
          <p role="alert" className="mt-2 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
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
  onListOpenChange,
}: Readonly<{
  contractNumber: number;
  selected: LinkCandidate | null;
  onSelect: (candidate: LinkCandidate | null) => void;
  /** Fires whenever the candidate list opens or closes. The dialog
   * around this control needs it for Escape: Radix listens for that key
   * on the document, so no amount of stopping the React event keeps the
   * modal from taking it. Must be stable across renders. */
  onListOpenChange: (open: boolean) => void;
}>) {
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Whether the pick that just changed was made here, so the focus
   * follows it. The box and the chip never exist at the same time, so
   * whichever one arrives has to be given the focus the other lost. */
  const pickedHere = useRef(false);

  const trimmed = query.trim();

  // The search runs only while the list is open, and only after typing
  // pauses. A closed picker is not a reason to ask the server anything,
  // and an empty box has nothing to ask about — the endpoint matches on
  // a term rather than listing every contract the viewer can reach.
  useEffect(() => {
    if (!open || trimmed.length === 0) {
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchLinkCandidates(contractNumber, trimmed).then((rows) => {
        // A slower earlier answer must never overwrite a later one.
        if (!live) return;
        setCandidates(rows);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, trimmed, contractNumber]);

  useEffect(() => {
    if (!pickedHere.current) return;
    pickedHere.current = false;
    if (selected) clearRef.current?.focus();
    else inputRef.current?.focus();
  }, [selected]);

  /** The list is drawn once there is a term to have searched for.
   * Before that it would be an empty box saying nothing was found,
   * about a search nobody ran. */
  const listOpen = open && trimmed.length > 0;

  useEffect(() => {
    onListOpenChange(listOpen);
  }, [listOpen, onListOpenChange]);

  const rowCount = candidates.length;
  const active = Math.min(activeIndex, Math.max(rowCount - 1, 0));
  const rowId = (index: number) => `${listboxId}-row-${index}`;

  // The list scrolls, and the arrow keys can walk past its foot. A
  // screen reader follows `aria-activedescendant` wherever it goes; a
  // sighted keyboard user has to be able to see the row it names.
  useEffect(() => {
    if (!listOpen || rowCount === 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [listOpen, rowCount, active]);

  function commit(index: number) {
    const candidate = candidates[index];
    if (!candidate) return;
    pickedHere.current = true;
    onSelect(candidate);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setCandidates([]);
  }

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-button border border-border-default bg-raised px-3 py-1.5 text-sm">
        <span className="font-medium">{contractReference(intl, selected.number)}</span>
        <span className="truncate">{selected.title}</span>
        <button
          ref={clearRef}
          type="button"
          aria-label={intl.formatMessage(MESSAGES.clearSelection)}
          className="ms-auto rounded-chip p-1 text-link hover:bg-control focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
          onClick={() => {
            pickedHere.current = true;
            onSelect(null);
            setQuery("");
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-activedescendant={listOpen && rowCount > 0 ? rowId(active) : undefined}
        aria-autocomplete="list"
        aria-busy={searching}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-button border border-border-default bg-raised px-3 py-1.5 text-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        aria-label={intl.formatMessage(MESSAGES.pickerPlaceholder)}
        placeholder={intl.formatMessage(MESSAGES.pickerPlaceholder)}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Candidates commit on pointerdown, ahead of this blur.
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (rowCount === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((active + delta + rowCount) % rowCount);
            return;
          }
          if (event.key === "Enter") {
            if (listOpen && rowCount > 0) {
              // A picked row must not also submit the dialog around it:
              // picking the contract and linking it are two acts.
              event.preventDefault();
              commit(active);
            }
            return;
          }
          if (event.key === "Escape") {
            // Local dismiss, as DES-010 reserves the key for. The stop
            // is what keeps the dialog open: without it the modal takes
            // the key and the whole form goes with the list.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <ul // NOSONAR — a select cannot search-narrow against the server
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={intl.formatMessage(MESSAGES.pickerListLabel)}
        // The attribute rather than the `hidden` utility: it takes the
        // list out of the accessibility tree as well as off the screen,
        // and Tailwind's preflight gives it `display: none !important`,
        // so no display utility added later can leave it showing.
        hidden={!listOpen}
        className="absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-card border border-border-default bg-raised py-1 shadow-md"
      >
        {candidates.map((candidate, index) => (
          <li
            key={candidate.number}
            id={rowId(index)}
            role="option"
            aria-selected={index === active}
            className={cn(
              "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm text-primary",
              index === active && "bg-control",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              commit(index);
            }}
            onMouseMove={() => setActiveIndex(index)}
          >
            <span className="font-medium">{contractReference(intl, candidate.number)}</span>
            <span className="truncate">{candidate.title}</span>
            <span
              className={`ms-auto inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[candidate.stage]}`}
            >
              {candidate.statusName}
            </span>
          </li>
        ))}
        {/* A disabled option, not a bare list item: non-option children
            of a listbox are not reliably exposed, so an empty answer
            would read as silence to assistive technology. */}
        {rowCount === 0 && (
          <li
            className="px-3 py-1.5 text-sm text-muted"
            role="option"
            aria-disabled="true"
            aria-selected={false}
          >
            <FormattedMessage
              {...(searching ? MESSAGES.pickerSearching : MESSAGES.pickerNoMatches)}
            />
          </li>
        )}
      </ul>
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
  /** Whether the picker's candidate list is showing. A ref rather than
   * state because the modal's Escape handler reads it inside the same
   * key event that closes the list, before React has flushed the render
   * that closed it. */
  const pickerListOpen = useRef(false);
  const handleListOpenChange = useCallback((open: boolean) => {
    pickerListOpen.current = open;
  }, []);

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
    setError(null);

    // The open side is the one that is not confidential. Flag it by the
    // ordinary confidentiality write, under its ordinary actor rule —
    // and when that rule refuses, say so rather than closing as if the
    // flag were set (CTR-018: a suggestion, not an outcome).
    const openNumber = nudge.thisIsConfidential ? nudge.otherNumber : nudge.thisNumber;
    const { response } = await api
      .PATCH("/api/v1/contracts/{number}", {
        params: { path: { number: openNumber } },
        body: { isConfidential: true },
      })
      .catch(() => ({ response: undefined }));

    setBusy(false);
    if (!response?.ok) {
      setError(
        intl.formatMessage(MESSAGES.nudgeError, {
          reference: contractReference(intl, openNumber),
        }),
      );
      return;
    }
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
        error={error}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Escape belongs to the innermost dismissable thing (DES-010).
        // While the picker's list is showing, that is the list, and the
        // picker's own handler is closing it — so the modal lets this
        // one go by.
        onEscapeKeyDown={(event) => {
          if (pickerListOpen.current) event.preventDefault();
        }}
      >
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
              onListOpenChange={handleListOpenChange}
            />
            {mode === "link" && (
              <div>
                <label
                  htmlFor="link-relation-type"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-subtle"
                >
                  <FormattedMessage {...MESSAGES.typeLabel} />
                </label>
                <select
                  id="link-relation-type"
                  className="w-full rounded-button border border-border-default bg-raised px-3 py-1.5 text-sm text-primary focus:outline-2 focus:outline-offset-2 focus:outline-link"
                  value={relationType}
                  onChange={(event) => setRelationType(event.target.value as RelationType)}
                >
                  {RELATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === "related"
                        ? intl.formatMessage({
                            id: "contracts.relations.relatedLabel",
                            defaultMessage: "Related",
                          })
                        : type === "renews"
                          ? intl.formatMessage({
                              id: "contracts.relations.renewsLabel",
                              defaultMessage: "Renews",
                            })
                          : intl.formatMessage({
                              id: "contracts.relations.amendsLabel",
                              defaultMessage: "Amends",
                            })}
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
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
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
