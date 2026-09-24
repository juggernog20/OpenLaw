// SPDX-License-Identifier: AGPL-3.0-only
import {
  and,
  or,
  sql,
  isNull,
  contracts,
  contractStatuses,
  contractCounterparties,
  matters,
  matterStatuses,
  type SQL,
  type AnyPgColumn,
} from "@openlaw/db";
import { searchProperty, type SearchQuestion } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { choiceFilter } from "../../lib/record-filters.js";
import { escapeLikePattern } from "../../lib/like.js";
import { nextDeadline } from "../../lib/next-deadline.js";

import { incompleteMatter } from "../../lib/incomplete-matter.js";

function compile(
  condition: SearchQuestion["conditions"][number],
  user: AuthenticatedUser,
  timeZone?: string,
): SQL {
  const { kind, property, operator, value } = condition;
  const record = kind === "contract" ? contracts : matters;
  const definition = searchProperty(kind, property)!;
  const columns: Record<string, AnyPgColumn | SQL> = {
    title: record.title,
    status: record.statusId,
    type: kind === "contract" ? contracts.contractTypeId : matters.matterTypeId,
    owner: contracts.managerId,
    manager: matters.managerId,
    businessOwner: matters.businessOwnerId,
    entity: contracts.entityId,
    priority: matters.priority,
    risk: matters.risk,
    effective: contracts.effectiveDate,
    expiry: contracts.expiryDate,
    noticeDeadline: sql`(${contracts.expiryDate} - ${contracts.noticePeriodDays})`,
    opened: sql`(${matters.openedAt} at time zone ${timeZone ?? user.timezone ?? "UTC"})::date`,
    deadline: sql`((${nextDeadline("matter")}) ->> 'date')::date`,
    confidential: record.isConfidential,
    incomplete: incompleteMatter,
  };
  const column = columns[property]!;
  if (definition.type === "choices") {
    const values = (value as string[]).join(",");
    const predicate =
      property === "counterparty"
        ? sql`exists (select 1 from ${contractCounterparties} where ${contractCounterparties.contractId} = ${contracts.id} and ${choiceFilter(contractCounterparties.counterpartyId, values)})`
        : choiceFilter(column as AnyPgColumn, values, user.id)!;
    return operator === "is_none_of" ? sql`not coalesce(${predicate}, false)` : predicate;
  }
  if (definition.type === "text") {
    const predicate = sql`coalesce(${column}, '') ilike ${`%${escapeLikePattern(value as string)}%`}`;
    return operator === "does_not_contain" ? sql`not (${predicate})` : predicate;
  }
  if (definition.type === "flag") {
    // Show flags include inactive rows; they do not mean "only inactive".
    if (property === "includeArchived") return value ? sql`true` : isNull(record.archivedAt);
    // Same test as the Contract list: the stage check also catches legacy ended rows without a stamp.
    if (property === "includeEnded")
      return value
        ? sql`true`
        : and(isNull(contracts.endedAt), sql`${contractStatuses.stage} <> 'ended'`)!;
    if (property === "includeClosed")
      return value ? sql`true` : sql`${matterStatuses.category} = 'open'`;
    return sql`${column} = ${value as boolean}`;
  }
  if (operator === "between") {
    const [from, to] = value as [string, string];
    return sql`${column} between ${from}::date and ${to}::date`;
  }
  if (operator === "before") return sql`${column} < ${value as string}::date`;
  if (operator === "after") return sql`${column} > ${value as string}::date`;
  return sql`${column} = ${value as string}::date`;
}

/** The caller ANDs this with reach inside the candidate read. */
export function conditionScope(
  kind: "contract" | "matter",
  question: SearchQuestion | undefined,
  user: AuthenticatedUser,
  timeZone?: string,
): SQL {
  const conditions = question?.conditions.filter((condition) => condition.kind === kind) ?? [];
  const record = kind === "contract" ? contracts : matters;
  return (
    and(
      conditions.some(
        (condition) => condition.property === "includeArchived" && condition.value === true,
      )
        ? undefined
        : isNull(record.archivedAt),
      (question?.match === "any" ? or : and)(
        ...conditions.map((condition) => compile(condition, user, timeZone)),
      ),
    ) ?? sql`true`
  );
}
