// SPDX-License-Identifier: AGPL-3.0-only

/** The URL-backed filter row and chips for M27/9's Entity registry. */
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import {
  ENTITY_STATUSES,
  statusLabel,
  type EntityRegistryOptions,
  type EntityStatus,
  type EntityTypeOption,
} from "../../lib/entities";
import { CONTROL_CLASS } from "../../lib/form-controls";
import type { EntityListFilters } from "./entities-columns";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

type FilterKey = keyof EntityListFilters;
type ChipKey = Exclude<FilterKey, "includeArchived">;

const MESSAGES = defineMessages({
  type: { id: "entities.list.filter.type", defaultMessage: "Type" },
  typeAll: { id: "entities.list.filter.type.all", defaultMessage: "All types" },
  status: { id: "entities.list.filter.status", defaultMessage: "Status" },
  statusAll: { id: "entities.list.filter.status.all", defaultMessage: "All statuses" },
  jurisdiction: {
    id: "entities.list.filter.jurisdiction",
    defaultMessage: "Jurisdiction",
  },
  jurisdictionAll: {
    id: "entities.list.filter.jurisdiction.all",
    defaultMessage: "All jurisdictions",
  },
  majorityOwner: {
    id: "entities.list.filter.majorityOwner",
    defaultMessage: "Majority owner",
  },
  majorityOwnerAll: {
    id: "entities.list.filter.majorityOwner.all",
    defaultMessage: "All majority owners",
  },
  active: { id: "entities.list.filter.active", defaultMessage: "Active filters" },
  chip: { id: "entities.list.filter.chip", defaultMessage: "{name}: {value}" },
  remove: { id: "entities.list.filter.remove", defaultMessage: "Remove {name} filter" },
  clear: { id: "entities.list.filter.clear", defaultMessage: "Clear all" },
  clearLabel: {
    id: "entities.list.filter.clear.label",
    defaultMessage: "Clear all filters",
  },
  matchedNone: {
    id: "entities.list.filter.matchedNone",
    defaultMessage: "The active filters matched no Entities.",
  },
  showArchived: {
    id: "entities.list.showArchived",
    defaultMessage: "Show archived",
  },
});

export function EntityListFilterBar({
  filters,
  types,
  options,
  busy,
  empty,
  error,
  onFilter,
  onClear,
}: Readonly<{
  filters: EntityListFilters;
  types: readonly EntityTypeOption[];
  options: EntityRegistryOptions;
  busy: boolean;
  empty: boolean;
  error: string | null;
  onFilter: <K extends FilterKey>(key: K, value: EntityListFilters[K]) => void;
  onClear: () => void;
}>) {
  const intl = useIntl();
  const type = types.find((candidate) => candidate.id === filters.type);
  const majorityOwner = options.majorityOwners.find(
    (candidate) => candidate.id === filters.majorityOwner,
  );
  const chips: { key: ChipKey; name: string; value: string }[] = [];
  if (filters.type) {
    chips.push({
      key: "type",
      name: intl.formatMessage(MESSAGES.type),
      value: type?.displayName ?? filters.type,
    });
  }
  if (filters.status) {
    chips.push({
      key: "status",
      name: intl.formatMessage(MESSAGES.status),
      value: statusLabel(intl, filters.status as EntityStatus),
    });
  }
  if (filters.jurisdiction) {
    chips.push({
      key: "jurisdiction",
      name: intl.formatMessage(MESSAGES.jurisdiction),
      value: filters.jurisdiction,
    });
  }
  if (filters.majorityOwner) {
    chips.push({
      key: "majorityOwner",
      name: intl.formatMessage(MESSAGES.majorityOwner),
      value: majorityOwner?.legalName ?? filters.majorityOwner,
    });
  }

  const selectClass = `${CONTROL_CLASS} w-auto min-w-36`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        {error && (
          <p role="alert" className="me-auto text-xs text-status-danger-fg">
            {error}
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.type} />
          <select
            aria-label={intl.formatMessage(MESSAGES.type)}
            className={selectClass}
            value={filters.type}
            disabled={busy}
            onChange={(event) => onFilter("type", event.target.value)}
          >
            <option value="">{intl.formatMessage(MESSAGES.typeAll)}</option>
            {types.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.status} />
          <select
            aria-label={intl.formatMessage(MESSAGES.status)}
            className={selectClass}
            value={filters.status}
            disabled={busy}
            onChange={(event) => onFilter("status", event.target.value)}
          >
            <option value="">{intl.formatMessage(MESSAGES.statusAll)}</option>
            {ENTITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(intl, status)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.jurisdiction} />
          <select
            aria-label={intl.formatMessage(MESSAGES.jurisdiction)}
            className={selectClass}
            value={filters.jurisdiction}
            disabled={busy}
            onChange={(event) => onFilter("jurisdiction", event.target.value)}
          >
            <option value="">{intl.formatMessage(MESSAGES.jurisdictionAll)}</option>
            {options.jurisdictions.map((jurisdiction) => (
              <option key={jurisdiction} value={jurisdiction}>
                {jurisdiction}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <FormattedMessage {...MESSAGES.majorityOwner} />
          <select
            aria-label={intl.formatMessage(MESSAGES.majorityOwner)}
            className={selectClass}
            value={filters.majorityOwner}
            disabled={busy}
            onChange={(event) => onFilter("majorityOwner", event.target.value)}
          >
            <option value="">{intl.formatMessage(MESSAGES.majorityOwnerAll)}</option>
            {options.majorityOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.legalName}
              </option>
            ))}
          </select>
        </label>
        <span className="ms-auto flex items-center gap-2 pb-1">
          <Label htmlFor="entities-list-show-archived">
            <FormattedMessage {...MESSAGES.showArchived} />
          </Label>
          <Switch
            id="entities-list-show-archived"
            checked={filters.includeArchived}
            disabled={busy}
            onCheckedChange={(checked) => onFilter("includeArchived", checked)}
          />
        </span>
      </div>
      {chips.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={intl.formatMessage(MESSAGES.active)}
        >
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              disabled={busy}
              aria-label={intl.formatMessage(MESSAGES.remove, { name: chip.name })}
              className="inline-flex items-center gap-1 rounded-pill bg-badge-count-bg px-2 py-1 text-xs font-medium text-badge-count-fg disabled:opacity-50"
              onClick={() => onFilter(chip.key, "")}
            >
              {intl.formatMessage(MESSAGES.chip, { name: chip.name, value: chip.value })}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={intl.formatMessage(MESSAGES.clearLabel)}
            onClick={onClear}
          >
            <FormattedMessage {...MESSAGES.clear} />
          </Button>
          {empty && <span className="sr-only">{intl.formatMessage(MESSAGES.matchedNone)}</span>}
        </div>
      )}
    </div>
  );
}
