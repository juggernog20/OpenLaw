// SPDX-License-Identifier: AGPL-3.0-only

/** The two record-side pickers for MTR-007's one Contract-to-Matter link. */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { contractReference } from "../../lib/contracts";
import {
  linkContractMatter,
  searchContractCandidates,
  searchMatterCandidates,
  type ContractLinkCandidate,
  type LinkedReachableMatter,
  type MatterLinkCandidate,
} from "../../lib/contract-matters";
import { matterReference } from "../../lib/matters";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const SEARCH_DEBOUNCE_MS = 200;

function isMatterCandidate(
  candidate: MatterLinkCandidate | ContractLinkCandidate,
): candidate is MatterLinkCandidate {
  return "statusCategory" in candidate;
}

type LinkSide =
  | {
      mode: "from-contract";
      contractNumber: number;
      anchorIsConfidential: boolean;
      onLinked: (matter: LinkedReachableMatter) => void;
    }
  | {
      mode: "from-matter";
      matterNumber: number;
      anchorIsConfidential: boolean;
      onLinked: () => void;
    };

export function ContractMatterLinkDialog(
  props: Readonly<
    LinkSide & {
      onClose: () => void;
    }
  >,
) {
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<(MatterLinkCandidate | ContractLinkCandidate)[]>([]);
  const [selected, setSelected] = useState<MatterLinkCandidate | ContractLinkCandidate | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [linkedMatter, setLinkedMatter] = useState<LinkedReachableMatter | null>(null);
  const trimmed = query.trim();
  const mode = props.mode;
  const anchorNumber = props.mode === "from-contract" ? props.contractNumber : props.matterNumber;

  useEffect(() => {
    if (trimmed === "" || selected) return;
    let live = true;
    const timer = setTimeout(() => {
      const search =
        mode === "from-contract"
          ? searchMatterCandidates(anchorNumber, trimmed)
          : searchContractCandidates(anchorNumber, trimmed);
      void search
        .then((rows) => {
          if (!live) return;
          setCandidates(rows);
          setSearching(false);
        })
        .catch(() => {
          if (!live) return;
          setSearching(false);
          setError(
            intl.formatMessage({
              id: "contractMatter.search.error",
              defaultMessage: "Eligible records could not be searched.",
            }),
          );
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [anchorNumber, intl, mode, selected, trimmed]);

  async function submit() {
    if (!selected || busy) return;
    if (props.mode === "from-contract" && !isMatterCandidate(selected)) return;
    if (props.mode === "from-matter" && isMatterCandidate(selected)) return;
    setBusy(true);
    setError(null);
    const result =
      props.mode === "from-contract"
        ? await linkContractMatter(props.contractNumber, selected.number)
        : await linkContractMatter(selected.number, props.matterNumber);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.detail ??
          intl.formatMessage({
            id: "contractMatter.link.error",
            defaultMessage: "The Contract could not be linked to the Matter.",
          }),
      );
      return;
    }
    setLinkedMatter(result.matter);
    if (result.confidentialityMismatch) {
      setMismatch(true);
      return;
    }
    finish(result.matter);
  }

  function finish(confirmed = linkedMatter) {
    if (props.mode === "from-contract") {
      if (!confirmed) return;
      props.onLinked(confirmed);
    } else {
      props.onLinked();
    }
    props.onClose();
  }

  if (mismatch && selected) {
    const contractNumber = props.mode === "from-contract" ? props.contractNumber : selected.number;
    const matterNumber = props.mode === "from-contract" ? selected.number : props.matterNumber;
    return (
      <Dialog open onOpenChange={(open) => !open && finish()}>
        <DialogContent>
          <DialogTitle>
            <FormattedMessage
              id="contractMatter.mismatch.title"
              defaultMessage="Confidentiality differs"
            />
          </DialogTitle>
          <p className="mt-2 text-sm text-secondary">
            <FormattedMessage
              id="contractMatter.mismatch.body"
              defaultMessage="{contract} and {matter} keep independent Confidential flags. Consider aligning them if that matches the work. This suggestion changes neither record."
              values={{
                contract: contractReference(intl, contractNumber),
                matter: matterReference(intl, matterNumber),
              }}
            />
          </p>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => finish()}>
              <FormattedMessage
                id="contractMatter.mismatch.dismiss"
                defaultMessage="Leave them as they are"
              />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const candidateListLabel = intl.formatMessage(
    props.mode === "from-contract"
      ? {
          id: "contractMatter.matterMatches",
          defaultMessage: "Matter matches",
        }
      : {
          id: "contractMatter.contractMatches",
          defaultMessage: "Contract matches",
        },
  );
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogTitle>
          {props.mode === "from-contract" ? (
            <FormattedMessage id="contractMatter.linkMatter" defaultMessage="Link to Matter" />
          ) : (
            <FormattedMessage id="contractMatter.linkContract" defaultMessage="Link Contract" />
          )}
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-matter-search">
              <FormattedMessage
                id="contractMatter.search"
                defaultMessage="Search by number or title"
              />
            </Label>
            <Input
              id="contract-matter-search"
              autoFocus
              value={selected ? selected.title : query}
              onChange={(event) => {
                const next = event.target.value;
                setSelected(null);
                setQuery(next);
                setCandidates([]);
                setSearching(next.trim() !== "");
                setError(null);
              }}
            />
          </div>
          {!selected && trimmed !== "" && (
            <ul
              className="max-h-56 overflow-y-auto rounded-md border border-border"
              aria-label={candidateListLabel}
            >
              {searching ? (
                <li className="p-3 text-sm text-muted">
                  <FormattedMessage id="contractMatter.searching" defaultMessage="Searching…" />
                </li>
              ) : candidates.length === 0 ? (
                <li className="p-3 text-sm text-muted">
                  <FormattedMessage
                    id="contractMatter.noMatches"
                    defaultMessage="No eligible records found."
                  />
                </li>
              ) : (
                candidates.map((candidate) => (
                  <li key={candidate.number}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-link"
                      onClick={() => setSelected(candidate)}
                    >
                      <span className="font-medium">
                        {props.mode === "from-contract"
                          ? matterReference(intl, candidate.number)
                          : contractReference(intl, candidate.number)}
                      </span>{" "}
                      <span className="min-w-0 break-words">{candidate.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {selected && props.anchorIsConfidential !== selected.isConfidential && (
            <p className="text-xs text-status-warning-fg">
              <FormattedMessage
                id="contractMatter.mismatch.preview"
                defaultMessage="These records have different Confidential flags. Linking will not change either one."
              />
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={props.onClose} disabled={busy}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button onClick={() => void submit()} disabled={!selected || busy}>
              <FormattedMessage id="action.link" defaultMessage="Link" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
