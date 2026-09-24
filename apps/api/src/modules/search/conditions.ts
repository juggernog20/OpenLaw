// SPDX-License-Identifier: AGPL-3.0-only
import {
  and,
  inArray,
  documents,
  documentVersions,
  documentVersionText,
  entities,
  requests,
  counterparties,
  knowledgeItems,
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
import { incompleteMatter } from "../../lib/incomplete-matter.js";
import { nextDeadline } from "../../lib/next-deadline.js";

import { renderFamilySql } from "../../lib/render-family.js";
import { documentOwnerCase } from "../documents/owner.js";
import { majorityOwnerId, nextObligationDueOn } from "../../lib/entity-search-properties.js";

const RECORDS = {
  contract: contracts,
  matter: matters,
  document: documents,
  entity: entities,
  request: requests,
  counterparty: counterparties,
  knowledge_item: knowledgeItems,
};

function compile(
  condition: SearchQuestion["conditions"][number],
  user: AuthenticatedUser,
  timeZone?: string,
): SQL {
  const { kind, property, operator, value } = condition;
  const record = RECORDS[kind];
  const definition = searchProperty(kind, property)!;
  const calendarDate = (column: AnyPgColumn) =>
    sql`(${column} at time zone ${timeZone ?? user.timezone ?? "UTC"})::date`;
  const family = renderFamilySql(documentVersions.mimeType, documentVersions.originalFilename);
  const columns: Record<string, AnyPgColumn | SQL> = {
    title: kind === "contract" ? contracts.title : matters.title,
    status: kind === "contract" ? contracts.statusId : matters.statusId,
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
    confidential: kind === "contract" ? contracts.isConfidential : matters.isConfidential,
    incomplete: incompleteMatter,
  };
  const otherColumns: Partial<Record<typeof kind, Record<string, AnyPgColumn | SQL>>> = {
    document: {
      owner: documentOwnerCase((owner) => owner.kindSql),
      format: sql`replace(${family}, 'presentation', 'powerpoint')`,
      type: sql`coalesce(${documentVersions.documentTypeId}, ${knowledgeItems.knowledgeTypeId})`,
      uploader: documentVersions.createdBy,
      uploaded: calendarDate(documentVersions.createdAt),
      textState: sql`coalesce(${documentVersionText.state}, case when ${family} in ('pdf', 'word', 'presentation', 'email') then 'pending' else 'unsupported' end)`,
    },
    entity: {
      type: entities.entityTypeId,
      jurisdiction: entities.jurisdiction,
      status: entities.status,
      majorityOwner: majorityOwnerId,
      nextObligation: nextObligationDueOn,
    },
    request: {
      type: requests.requestTypeId,
      urgency: requests.urgency,
      status: requests.status,
      requester: requests.requesterId,
      received: calendarDate(requests.createdAt),
    },
    counterparty: { jurisdiction: counterparties.jurisdiction },
    knowledge_item: {
      type: knowledgeItems.knowledgeTypeId,
      state: knowledgeItems.state,
      folder: knowledgeItems.folderId,
    },
  };
  const column = (otherColumns[kind] ?? columns)[property]!;
  if (definition.type === "choices") {
    const values = (value as string[]).join(",");
    const predicate =
      property === "counterparty"
        ? sql`exists (select 1 from ${contractCounterparties} where ${contractCounterparties.contractId} = ${kind === "document" ? documents.contractId : contracts.id} and ${choiceFilter(contractCounterparties.counterpartyId, values)})`
        : property === "jurisdiction"
          ? inArray(sql`${column}`, value as string[])
          : choiceFilter(column, values, user.id)!;
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
  kind: SearchQuestion["kinds"][number],
  question: SearchQuestion | undefined,
  user: AuthenticatedUser,
  timeZone?: string,
): SQL {
  const conditions = question?.conditions.filter((condition) => condition.kind === kind) ?? [];
  const record = RECORDS[kind];
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
