// SPDX-License-Identifier: AGPL-3.0-only

/** Search-and-pick dialog for a Matter parent or undirected related Matter. */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  MATTER_PARENT_CYCLE_PROBLEM_TYPE,
  MATTER_RELATION_EXISTS_PROBLEM_TYPE,
  MATTER_SELF_RELATION_PROBLEM_TYPE,
} from "@openlaw/shared";
import {
  addMatterRelation,
  searchMatterCandidates,
  setMatterParent,
  type MatterRelationCandidate,
  type MatterRelations,
} from "../../lib/matter-relations";
import { matterReference } from "../../lib/matters";
import { problemType } from "../../lib/messages";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function MatterRelationDialog({
  number,
  mode,
  onOpenChange,
  onChanged,
}: Readonly<{
  number: number;
  mode: "parent" | "related";
  onOpenChange: (open: boolean) => void;
  onChanged: (relations: MatterRelations) => void;
}>) {
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MatterRelationCandidate[]>([]);
  const [selected, setSelected] = useState<MatterRelationCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(() => {
      void searchMatterCandidates(number, q)
        .then((rows) => {
          if (live) setCandidates(rows);
        })
        .catch(() => undefined)
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [number, query]);

  async function submit() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    const result =
      mode === "parent"
        ? await setMatterParent(number, selected.number)
        : await addMatterRelation(number, selected.number);
    setBusy(false);
    if (result.data) {
      onChanged(result.data);
      onOpenChange(false);
      return;
    }
    const type = problemType(result.error);
    setError(
      type === MATTER_RELATION_EXISTS_PROBLEM_TYPE
        ? intl.formatMessage({
            id: "matters.relations.duplicate",
            defaultMessage: "These Matters are already related.",
          })
        : type === MATTER_PARENT_CYCLE_PROBLEM_TYPE
          ? intl.formatMessage({
              id: "matters.relations.cycle",
              defaultMessage: "That parent would close a loop in the Matter hierarchy.",
            })
          : type === MATTER_SELF_RELATION_PROBLEM_TYPE
            ? intl.formatMessage({
                id: "matters.relations.self",
                defaultMessage: "A Matter cannot be related to itself.",
              })
            : intl.formatMessage({
                id: "matters.relations.saveError",
                defaultMessage: "The Matter relationship could not be saved.",
              }),
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {mode === "parent" ? (
            <FormattedMessage id="matters.relations.setParent" defaultMessage="Set parent" />
          ) : (
            <FormattedMessage
              id="matters.relations.addRelated"
              defaultMessage="Add related Matter"
            />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="matter-relation-search">
            <FormattedMessage
              id="matters.relations.searchLabel"
              defaultMessage="Search by M-number or title"
            />
          </Label>
          <Input
            id="matter-relation-search"
            autoFocus
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setCandidates([]);
              setSearching(next.trim().length > 0);
              setSelected(null);
              setError(null);
            }}
          />
          {searching ? (
            <p className="text-sm text-muted">
              <FormattedMessage id="matters.relations.searching" defaultMessage="Searching…" />
            </p>
          ) : query.trim() && candidates.length === 0 ? (
            <p className="text-sm text-muted">
              <FormattedMessage
                id="matters.relations.noMatches"
                defaultMessage="No Matters to link."
              />
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-control border border-border-default">
              {candidates.map((candidate) => (
                <li key={candidate.number}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-control ${
                      selected?.number === candidate.number ? "bg-control" : ""
                    }`}
                    aria-pressed={selected?.number === candidate.number}
                    onClick={() => setSelected(candidate)}
                  >
                    <span className="font-medium">{matterReference(intl, candidate.number)}</span>
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                    <span className="text-xs text-muted">{candidate.statusName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={!selected || busy}>
              {mode === "parent" ? (
                <FormattedMessage id="matters.relations.saveParent" defaultMessage="Set parent" />
              ) : (
                <FormattedMessage
                  id="matters.relations.saveRelated"
                  defaultMessage="Add relation"
                />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
