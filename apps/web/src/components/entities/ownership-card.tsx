// SPDX-License-Identifier: AGPL-3.0-only

/** The two-direction Ownership tab and its Entity combobox (ENT-003). */
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problem } from "../../lib/problem";
import type {
  EntityHolding,
  EntityHoldings,
  EntityHoldingWarning,
  EntityRow,
} from "../../lib/entities";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RestrictedRecordCell } from "../restricted-record-cell";

export function OwnershipCard({
  entity,
  candidates,
  initial,
  frozen,
}: Readonly<{
  entity: EntityRow;
  candidates: EntityRow[];
  initial: EntityHoldings;
  frozen: boolean;
}>) {
  const intl = useIntl();
  const [holdings, setHoldings] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replaceWarning(ownedEntityId: string, next: EntityHoldingWarning[]) {
    setHoldings((current) => ({
      ...current,
      warnings: [
        ...current.warnings.filter((warning) => warning.ownedEntityId !== ownedEntityId),
        ...next,
      ],
    }));
  }

  async function update(row: EntityHolding, ownershipPercent: number) {
    setError(null);
    if (row.owner.restricted || row.owned.restricted) return;
    const relatedEntityId = row.owner.id === entity.id ? row.owned.id : row.owner.id;
    const result = await api
      .PATCH("/api/v1/entities/{id}/holdings/{relatedEntityId}", {
        params: { path: { id: entity.id, relatedEntityId } },
        body: { ownershipPercent },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.ownership.updateError",
            defaultMessage: "The Holding could not be updated.",
          }),
      );
      return;
    }
    const next = result.data.holding;
    if (next.owner.restricted || next.owned.restricted) return;
    const nextOwnerId = next.owner.id;
    const nextOwnedId = next.owned.id;
    setHoldings((current) => ({
      ...current,
      owners: current.owners.map((held) =>
        !held.owner.restricted && held.owner.id === nextOwnerId ? next : held,
      ),
      owned: current.owned.map((held) =>
        !held.owned.restricted && held.owned.id === nextOwnedId ? next : held,
      ),
    }));
    replaceWarning(next.owned.id, result.data.warnings);
  }

  async function remove(row: EntityHolding) {
    setError(null);
    if (row.owner.restricted || row.owned.restricted) return;
    const relatedEntityId = row.owner.id === entity.id ? row.owned.id : row.owner.id;
    const removed = await api
      .DELETE("/api/v1/entities/{id}/holdings/{relatedEntityId}", {
        params: { path: { id: entity.id, relatedEntityId } },
      })
      .catch(() => undefined);
    if (!removed?.response.ok) {
      setError(
        (await problem(removed)).detail ??
          intl.formatMessage({
            id: "entities.ownership.removeError",
            defaultMessage: "The Holding could not be removed.",
          }),
      );
      return;
    }
    const refreshed = await api.GET("/api/v1/entities/{id}/holdings", {
      params: { path: { id: entity.id } },
    });
    if (refreshed.data) setHoldings(refreshed.data);
  }

  function added(holding: EntityHolding, warnings: EntityHoldingWarning[]) {
    if (holding.owner.restricted || holding.owned.restricted) return;
    const heldByAnchor = holding.owned.id === entity.id;
    const anchorOwns = holding.owner.id === entity.id;
    setHoldings((current) => ({
      ...current,
      owners: heldByAnchor ? [...current.owners, holding] : current.owners,
      owned: anchorOwns ? [...current.owned, holding] : current.owned,
    }));
    replaceWarning(holding.owned.id, warnings);
    setDialogOpen(false);
  }

  const relatedIds = new Set([
    entity.id,
    ...holdings.owners.flatMap((row) => (row.owner.restricted ? [] : [row.owner.id])),
    ...holdings.owned.flatMap((row) => (row.owned.restricted ? [] : [row.owned.id])),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {holdings.warnings.map((warning) => (
        <p
          key={warning.ownedEntityId}
          role="alert"
          className="rounded-card border border-status-warning-fg bg-status-warning-bg px-3 py-2 text-sm text-status-warning-fg"
        >
          <FormattedMessage
            id="entities.ownership.overTotal"
            defaultMessage="Ownership totals {total}% for {name}."
            values={{ total: warning.totalPercent, name: warning.legalName }}
          />
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 @2xl/page:grid-cols-2">
        <HoldingList
          title={<FormattedMessage id="entities.ownership.owners" defaultMessage="Owners" />}
          empty={intl.formatMessage({
            id: "entities.ownership.noOwners",
            defaultMessage: "No Entity owns this Entity.",
          })}
          rows={holdings.owners}
          entityId={entity.id}
          frozen={frozen}
          onUpdate={update}
          onRemove={remove}
        />
        <HoldingList
          title={<FormattedMessage id="entities.ownership.owned" defaultMessage="Owned Entities" />}
          empty={intl.formatMessage({
            id: "entities.ownership.noneOwned",
            defaultMessage: "This Entity owns no other Entities.",
          })}
          rows={holdings.owned}
          entityId={entity.id}
          frozen={frozen}
          onUpdate={update}
          onRemove={remove}
        />
      </div>
      <div>
        <Button disabled={frozen} onClick={() => setDialogOpen(true)}>
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage id="entities.ownership.addHolding" defaultMessage="Add Holding" />
        </Button>
      </div>
      {dialogOpen ? (
        <AddHoldingDialog
          entityId={entity.id}
          candidates={candidates.filter((candidate) => !relatedIds.has(candidate.id))}
          onOpenChange={setDialogOpen}
          onAdded={added}
        />
      ) : null}
    </div>
  );
}

function HoldingList({
  title,
  empty,
  rows,
  entityId,
  frozen,
  onUpdate,
  onRemove,
}: Readonly<{
  title: ReactNode;
  empty: string;
  rows: EntityHolding[];
  entityId: string;
  frozen: boolean;
  onUpdate: (row: EntityHolding, percent: number) => Promise<void>;
  onRemove: (row: EntityHolding) => Promise<void>;
}>) {
  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">{title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border-default">
          {rows.map((row, index) => {
            const related =
              !row.owner.restricted && row.owner.id === entityId ? row.owned : row.owner;
            return (
              <HoldingRow
                key={related.restricted ? `restricted-${index}` : related.id}
                row={row}
                related={related}
                frozen={frozen}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HoldingRow({
  row,
  related,
  frozen,
  onUpdate,
  onRemove,
}: Readonly<{
  row: EntityHolding;
  related: EntityHolding["owner"];
  frozen: boolean;
  onUpdate: (row: EntityHolding, percent: number) => Promise<void>;
  onRemove: (row: EntityHolding) => Promise<void>;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState(String(row.ownershipPercent));
  if (related.restricted) {
    return (
      <RestrictedRecordCell
        as="li"
        className="px-4 py-3"
        label={{ id: "entities.restricted", defaultMessage: "Restricted Entity" }}
      />
    );
  }
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link
        to={`/entities/${related.id}`}
        className="min-w-0 flex-1 truncate font-medium text-link"
      >
        {related.legalName}
      </Link>
      <div className="flex items-center gap-1">
        <Input
          className="w-24"
          type="number"
          min={0}
          max={100}
          step="0.01"
          disabled={frozen}
          aria-label={intl.formatMessage(
            {
              id: "entities.ownership.rowPercent",
              defaultMessage: "{name} ownership percent",
            },
            { name: related.legalName },
          )}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const value = Number(draft);
            if (Number.isFinite(value) && value !== row.ownershipPercent) void onUpdate(row, value);
          }}
        />
        <span aria-hidden="true" className="text-sm text-muted">
          %
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        disabled={frozen}
        aria-label={intl.formatMessage(
          { id: "entities.ownership.remove", defaultMessage: "Remove {name}" },
          { name: related.legalName },
        )}
        onClick={() => void onRemove(row)}
      >
        <Trash2 size={16} aria-hidden="true" />
      </Button>
    </li>
  );
}

function AddHoldingDialog({
  entityId,
  candidates,
  onOpenChange,
  onAdded,
}: Readonly<{
  entityId: string;
  candidates: EntityRow[];
  onOpenChange: (open: boolean) => void;
  onAdded: (holding: EntityHolding, warnings: EntityHoldingWarning[]) => void;
}>) {
  const intl = useIntl();
  const listboxId = useId();
  const [direction, setDirection] = useState<"owner" | "owned">("owner");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EntityRow | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [percent, setPercent] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const matches = candidates.filter((candidate) =>
    candidate.legalName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  async function submit() {
    if (!selected) {
      setError(
        intl.formatMessage({
          id: "entities.ownership.pickEntity",
          defaultMessage: "Pick an Entity.",
        }),
      );
      return;
    }
    const ownershipPercent = Number(percent);
    const result = await api
      .POST("/api/v1/entities/{id}/holdings", {
        params: { path: { id: entityId } },
        body: { direction, relatedEntityId: selected.id, ownershipPercent },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.ownership.addFailed",
            defaultMessage: "The Holding could not be added.",
          }),
      );
      return;
    }
    onAdded(result.data.holding, result.data.warnings);
  }

  function choose(candidate: EntityRow) {
    setSelected(candidate);
    setQuery(candidate.legalName);
    setOpen(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="entities.ownership.dialogTitle" defaultMessage="Add Holding" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holding-direction">
              <FormattedMessage
                id="entities.ownership.relationship"
                defaultMessage="Relationship"
              />
            </Label>
            <select
              id="holding-direction"
              className={CONTROL_CLASS}
              value={direction}
              onChange={(event) => setDirection(event.target.value as "owner" | "owned")}
            >
              <option value="owner">
                {intl.formatMessage({
                  id: "entities.ownership.directionOwner",
                  defaultMessage: "Owns this Entity",
                })}
              </option>
              <option value="owned">
                {intl.formatMessage({
                  id: "entities.ownership.directionOwned",
                  defaultMessage: "This Entity owns",
                })}
              </option>
            </select>
          </div>
          <div className="relative flex flex-col gap-1.5">
            <Label htmlFor="holding-entity">
              <FormattedMessage id="entities.ownership.entityLabel" defaultMessage="Entity" />
            </Label>
            <Input
              id="holding-entity"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={
                open && matches[activeIndex] ? `${listboxId}-${matches[activeIndex].id}` : undefined
              }
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
                setActiveIndex(0);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex((current) => (current + 1) % Math.max(matches.length, 1));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex(
                    (current) =>
                      (current - 1 + Math.max(matches.length, 1)) % Math.max(matches.length, 1),
                  );
                }
                if (event.key === "Enter" && open && matches[activeIndex]) {
                  event.preventDefault();
                  choose(matches[activeIndex]);
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
            />
            {open ? (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={intl.formatMessage({
                  id: "entities.ownership.matches",
                  defaultMessage: "Entity matches",
                })}
                className="absolute top-full z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-card border border-border-default bg-overlay p-1 shadow-lg"
              >
                {matches.map((candidate, index) => (
                  <li
                    id={`${listboxId}-${candidate.id}`}
                    key={candidate.id}
                    role="option"
                    aria-selected={selected?.id === candidate.id}
                    className={`cursor-pointer rounded-button px-3 py-2 text-sm ${index === activeIndex ? "bg-selected" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(candidate)}
                  >
                    {candidate.legalName}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holding-percent">
              <FormattedMessage
                id="entities.ownership.percentLabel"
                defaultMessage="Ownership percent"
              />
            </Label>
            <Input
              id="holding-percent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit">
              <FormattedMessage id="common.add" defaultMessage="Add" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
