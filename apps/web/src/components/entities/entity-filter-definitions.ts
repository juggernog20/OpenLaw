// SPDX-License-Identifier: AGPL-3.0-only

/** DES-046's Entities catalogue: the registry list and the compliance calendar filter choices. */

import { useIntl } from "react-intl";
import { ENTITY_STATUSES, statusLabel, type EntityTypeOption } from "../../lib/entities";
import type { RecordFilter } from "../table/record-filter-bar";

/** Type, Status, Jurisdiction and Majority owner take one value each,
 * because GET /entities takes one; Show archived is a flag. The keys are
 * the M27/9 keys, so saved views and links made before the shared bar
 * still apply. */
export function useEntityFilterDefinitions(options: {
  types: readonly EntityTypeOption[];
  jurisdictions: readonly string[];
  majorityOwners: readonly { id: string; legalName: string }[];
}): RecordFilter[] {
  const intl = useIntl();
  return [
    {
      key: "type",
      label: intl.formatMessage({ id: "recordFilters.type", defaultMessage: "Type" }),
      kind: "choices",
      multiple: false,
      choices: options.types.map((type) => ({ id: type.id, displayName: type.displayName })),
    },
    {
      key: "status",
      label: intl.formatMessage({ id: "recordFilters.status", defaultMessage: "Status" }),
      kind: "choices",
      multiple: false,
      choices: ENTITY_STATUSES.map((status) => ({
        id: status,
        displayName: statusLabel(intl, status),
      })),
    },
    {
      key: "jurisdiction",
      label: intl.formatMessage({
        id: "entities.list.filter.jurisdiction",
        defaultMessage: "Jurisdiction",
      }),
      kind: "choices",
      multiple: false,
      choices: options.jurisdictions.map((jurisdiction) => ({
        id: jurisdiction,
        displayName: jurisdiction,
      })),
    },
    {
      key: "majorityOwner",
      label: intl.formatMessage({
        id: "entities.list.filter.majorityOwner",
        defaultMessage: "Majority owner",
      }),
      kind: "choices",
      multiple: false,
      choices: options.majorityOwners.map((owner) => ({
        id: owner.id,
        displayName: owner.legalName,
      })),
    },
    {
      key: "includeArchived",
      label: intl.formatMessage({
        id: "entities.list.showArchived",
        defaultMessage: "Show archived",
      }),
      kind: "flag",
    },
  ];
}

/** The calendar's Entity, Assignee, Due date and Show completed. The
 * date pair is `dueFrom`/`dueTo` on the bar and `from`/`to` in the URL
 * and the calendar read, which predate the bar. */
export function useCalendarFilterDefinitions(options: {
  entities: readonly { id: string; displayName: string }[];
  users: readonly { id: string; displayName: string }[];
}): RecordFilter[] {
  const intl = useIntl();
  return [
    {
      key: "entity",
      label: intl.formatMessage({ id: "entities.calendar.entity", defaultMessage: "Entity" }),
      kind: "choices",
      multiple: false,
      choices: [...options.entities],
    },
    {
      key: "assignee",
      label: intl.formatMessage({ id: "entities.calendar.assignee", defaultMessage: "Assignee" }),
      kind: "choices",
      multiple: false,
      choices: [...options.users],
    },
    {
      key: "due",
      label: intl.formatMessage({ id: "entities.calendar.due", defaultMessage: "Due date" }),
      kind: "date",
    },
    {
      key: "includeCompleted",
      label: intl.formatMessage({
        id: "entities.calendar.includeCompleted",
        defaultMessage: "Show completed",
      }),
      kind: "flag",
    },
  ];
}
