// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compiles a question's conditions into the SQL each kind's candidate
 * read ANDs with reach (DOC-009, M44 close addendum clause 3). Match any
 * ORs the conditions of one kind; conditions on different kinds never
 * meet. A Show flag widens rather than narrows: set to Yes it admits
 * archived, ended or closed rows, and left out it keeps the archive rule
 * in force. Conditions on live Fields hand off to `field-conditions.ts`.
 */

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
import { searchProperty, type SearchQuestion, type SearchField } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { choiceFilter } from "../../lib/record-filters.js";
import { escapeLikePattern } from "../../lib/like.js";
import { incompleteMatter } from "../../lib/incomplete-matter.js";
import { relativeDateRange } from "./relative-dates.js";
import { nextDeadline } from "../../lib/next-deadline.js";

import { renderFamilySql } from "../../lib/render-family.js";
import { TEXT_FAMILIES } from "../../pipeline/text-extraction.js";
import { documentOwnerCase } from "../documents/owner.js";
import { majorityOwnerId, nextObligationDueOn } from "../../lib/entity-search-properties.js";

import { compileFieldCondition } from "./field-conditions.js";

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
  timeZone: string | undefined,
  now: Date,
  catalog: readonly SearchField[],
): SQL {
  if (condition.property.startsWith("field:")) {
    const field = catalog.find(
      (field) =>
        field.moduleScope === condition.kind && `field:${field.slug}` === condition.property,
    )!;
    return compileFieldCondition(condition, field, user, timeZone, now);
  }
  const { kind, property, operator, value } = condition;
  const record = RECORDS[kind];
  const definition = searchProperty(kind, property)!;
  // The Inbox's Received filter chain: the request, then the profile, then UTC.
  const zone = timeZone ?? user.timezone ?? "UTC";
  const calendarDate = (column: AnyPgColumn) => sql`(${column} at time zone ${zone})::date`;
  const family = renderFamilySql(documentVersions.mimeType, documentVersions.originalFilename);
  // One column or expression per property, keyed by the kind it belongs to.
  const columns: Record<typeof kind, Record<string, AnyPgColumn | SQL>> = {
    contract: {
      title: contracts.title,
      status: contracts.statusId,
      type: contracts.contractTypeId,
      owner: contracts.managerId,
      entity: contracts.entityId,
      effective: contracts.effectiveDate,
      expiry: contracts.expiryDate,
      noticeDeadline: sql`(${contracts.expiryDate} - ${contracts.noticePeriodDays})`,
      confidential: contracts.isConfidential,
    },
    matter: {
      title: matters.title,
      status: matters.statusId,
      type: matters.matterTypeId,
      manager: matters.managerId,
      businessOwner: matters.businessOwnerId,
      priority: matters.priority,
      risk: matters.risk,
      opened: calendarDate(matters.openedAt),
      deadline: sql`((${nextDeadline("matter")}) ->> 'date')::date`,
      confidential: matters.isConfidential,
      incomplete: incompleteMatter,
    },
    document: {
      owner: documentOwnerCase((owner) => owner.kindSql),
      // The repository calls the presentation family "powerpoint".
      format: sql`replace(${family}, 'presentation', 'powerpoint')`,
      type: sql`coalesce(${documentVersions.documentTypeId}, ${knowledgeItems.knowledgeTypeId})`,
      uploader: documentVersions.createdBy,
      uploaded: calendarDate(documentVersions.createdAt),
      // Same answer as the text read: no derivation row means pending for
      // a family the pipeline reads, unsupported for every other.
      textState: sql`coalesce(${documentVersionText.state}, case when ${family} in (${sql.join(
        TEXT_FAMILIES.map((name) => sql`${name}`),
        sql`, `,
      )}) then 'pending' else 'unsupported' end)`,
    },
    entity: {
      type: entities.entityTypeId,
      jurisdiction: entities.jurisdiction,
      status: entities.status,
      majorityOwner: majorityOwnerId,
      nextObligation: nextObligationDueOn,
    },
    counterparty: { jurisdiction: counterparties.jurisdiction },
    request: {
      type: requests.requestTypeId,
      urgency: requests.urgency,
      status: requests.status,
      requester: requests.requesterId,
      received: calendarDate(requests.createdAt),
    },
    knowledge_item: {
      type: knowledgeItems.knowledgeTypeId,
      state: knowledgeItems.state,
      folder: knowledgeItems.folderId,
    },
  };
  const column = columns[kind][property]!;
  if (definition.type === "choices") {
    const predicate =
      property === "counterparty"
        ? sql`exists (select 1 from ${contractCounterparties} where ${contractCounterparties.contractId} = ${kind === "document" ? documents.contractId : contracts.id} and ${choiceFilter(contractCounterparties.counterpartyId, (value as string[]).join(","))})`
        : definition.free
          ? inArray(sql`${column}`, value as string[])
          : choiceFilter(column, (value as string[]).join(","), user.id)!;
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
  const relative = relativeDateRange(operator, value, now, zone);
  if (relative) {
    const [from, to] = relative;
    return sql`${column} between ${from}::date and ${to}::date`;
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
  now = new Date(),
  catalog: readonly SearchField[] = [],
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
        ...conditions.map((condition) => compile(condition, user, timeZone, now, catalog)),
      ),
    ) ?? sql`true`
  );
}
