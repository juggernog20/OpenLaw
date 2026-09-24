// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { type SearchQuestion, type SearchField } from "@openlaw/shared";
import { defineMessages, useIntl, type IntlShape, type MessageDescriptor } from "react-intl";
import { useOtherConditionDefinitions } from "./other-condition-definitions";
import { useSearchFields } from "./field-definitions";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import {
  useRecordFilterDefinitions,
  type RecordFilterOptions,
} from "../table/record-filter-definitions";

export const OPERATOR_LABELS = defineMessages({
  equals: { id: "search.operator.equals", defaultMessage: "equals" },
  greater_than: { id: "search.operator.greaterThan", defaultMessage: "greater than" },
  less_than: { id: "search.operator.lessThan", defaultMessage: "less than" },
  is_empty: { id: "search.operator.empty", defaultMessage: "is empty" },
  is_not_empty: { id: "search.operator.notEmpty", defaultMessage: "is not empty" },
  is_yes: { id: "search.operator.yes", defaultMessage: "is yes" },
  is_no: { id: "search.operator.no", defaultMessage: "is no" },
  includes_any: { id: "search.operator.includesAny", defaultMessage: "includes any" },
  includes_all: { id: "search.operator.includesAll", defaultMessage: "includes all" },
  includes_none: { id: "search.operator.includesNone", defaultMessage: "includes none" },
  is_any_of: { id: "search.operator.any", defaultMessage: "is any of" },
  is_none_of: { id: "search.operator.none", defaultMessage: "is none of" },
  contains: { id: "search.operator.contains", defaultMessage: "contains" },
  does_not_contain: { id: "search.operator.notContains", defaultMessage: "does not contain" },
  is: { id: "search.operator.is", defaultMessage: "is" },
  before: { id: "search.operator.before", defaultMessage: "before" },
  after: { id: "search.operator.after", defaultMessage: "after" },
  on: { id: "search.operator.on", defaultMessage: "on" },
  between: { id: "search.operator.between", defaultMessage: "between" },
  today: { id: "search.operator.today", defaultMessage: "today" },
  this_week: { id: "search.operator.thisWeek", defaultMessage: "this week" },
  this_month: { id: "search.operator.thisMonth", defaultMessage: "this month" },
  this_quarter: { id: "search.operator.thisQuarter", defaultMessage: "this quarter" },
  this_year: { id: "search.operator.thisYear", defaultMessage: "this year" },
});
type DayOperator = "in_last_days" | "in_next_days";
// The operator list names N; a chip carries the typed count.
const DAY_OPERATOR_LABELS: Record<DayOperator, MessageDescriptor> = defineMessages({
  in_last_days: { id: "search.operator.lastDays", defaultMessage: "in the last N days" },
  in_next_days: { id: "search.operator.nextDays", defaultMessage: "in the next N days" },
});
const DAY_COUNT_LABELS: Record<DayOperator, MessageDescriptor> = defineMessages({
  in_last_days: {
    id: "search.operator.lastDays.count",
    defaultMessage: "in the last {days, plural, one {# day} other {# days}}",
  },
  in_next_days: {
    id: "search.operator.nextDays.count",
    defaultMessage: "in the next {days, plural, one {# day} other {# days}}",
  },
});
export function operatorLabel(intl: IntlShape, operator: string, days?: number) {
  if (operator === "in_last_days" || operator === "in_next_days")
    return typeof days === "number"
      ? intl.formatMessage(DAY_COUNT_LABELS[operator], { days })
      : intl.formatMessage(DAY_OPERATOR_LABELS[operator]);
  return operator in OPERATOR_LABELS
    ? intl.formatMessage(OPERATOR_LABELS[operator as keyof typeof OPERATOR_LABELS])
    : operator;
}
const PROPERTY_LABELS = defineMessages({
  "contract.status": { id: "search.property.contract.status", defaultMessage: "Status" },
  "contract.type": { id: "search.property.contract.type", defaultMessage: "Type" },
  "contract.owner": { id: "search.property.contract.owner", defaultMessage: "Owner" },
  "contract.counterparty": {
    id: "search.property.contract.counterparty",
    defaultMessage: "Counterparty",
  },
  "contract.entity": { id: "search.property.contract.entity", defaultMessage: "Signing Entity" },
  "contract.effective": {
    id: "search.property.contract.effective",
    defaultMessage: "Effective date",
  },
  "contract.expiry": { id: "search.property.contract.expiry", defaultMessage: "Expiry date" },
  "contract.noticeDeadline": {
    id: "search.property.contract.noticeDeadline",
    defaultMessage: "Notice deadline",
  },
  "contract.confidential": {
    id: "search.property.contract.confidential",
    defaultMessage: "Confidential",
  },
  "contract.includeEnded": {
    id: "search.property.contract.includeEnded",
    defaultMessage: "Show ended",
  },
  "contract.includeArchived": {
    id: "search.property.contract.includeArchived",
    defaultMessage: "Show archived",
  },
  "contract.title": { id: "search.property.contract.title", defaultMessage: "Title" },
  "matter.type": { id: "search.property.matter.type", defaultMessage: "Type" },
  "matter.status": { id: "search.property.matter.status", defaultMessage: "Status" },
  "matter.priority": { id: "search.property.matter.priority", defaultMessage: "Priority" },
  "matter.risk": { id: "search.property.matter.risk", defaultMessage: "Risk" },
  "matter.manager": { id: "search.property.matter.manager", defaultMessage: "Matter Manager" },
  "matter.businessOwner": {
    id: "search.property.matter.businessOwner",
    defaultMessage: "Business Owner",
  },
  "matter.opened": { id: "search.property.matter.opened", defaultMessage: "Opened date" },
  "matter.deadline": { id: "search.property.matter.deadline", defaultMessage: "Next deadline" },
  "matter.incomplete": { id: "search.property.matter.incomplete", defaultMessage: "Incomplete" },
  "matter.confidential": {
    id: "search.property.matter.confidential",
    defaultMessage: "Confidential",
  },
  "matter.includeClosed": {
    id: "search.property.matter.includeClosed",
    defaultMessage: "Show closed",
  },
  "matter.includeArchived": {
    id: "search.property.matter.includeArchived",
    defaultMessage: "Show archived",
  },
  "matter.title": { id: "search.property.matter.title", defaultMessage: "Title" },
  "document.owner": { id: "search.property.document.owner", defaultMessage: "Owning module" },
  "document.format": { id: "search.property.document.format", defaultMessage: "Format" },
  "document.type": { id: "search.property.document.type", defaultMessage: "Document type" },
  "document.counterparty": {
    id: "search.property.document.counterparty",
    defaultMessage: "Counterparty",
  },
  "document.uploader": { id: "search.property.document.uploader", defaultMessage: "Uploader" },
  "document.uploaded": { id: "search.property.document.uploaded", defaultMessage: "Uploaded date" },
  "document.textState": { id: "search.property.document.textState", defaultMessage: "Text state" },
  "document.includeArchived": {
    id: "search.property.document.includeArchived",
    defaultMessage: "Show archived",
  },
  "entity.type": { id: "search.property.entity.type", defaultMessage: "Type" },
  "entity.jurisdiction": {
    id: "search.property.entity.jurisdiction",
    defaultMessage: "Jurisdiction",
  },
  "entity.status": { id: "search.property.entity.status", defaultMessage: "Status" },
  "entity.majorityOwner": {
    id: "search.property.entity.majorityOwner",
    defaultMessage: "Majority owner",
  },
  "entity.nextObligation": {
    id: "search.property.entity.nextObligation",
    defaultMessage: "Next obligation date",
  },
  "entity.includeArchived": {
    id: "search.property.entity.includeArchived",
    defaultMessage: "Show archived",
  },
  "request.type": { id: "search.property.request.type", defaultMessage: "Type" },
  "request.urgency": { id: "search.property.request.urgency", defaultMessage: "Urgency" },
  "request.status": { id: "search.property.request.status", defaultMessage: "Status" },
  "request.requester": { id: "search.property.request.requester", defaultMessage: "Requester" },
  "request.received": { id: "search.property.request.received", defaultMessage: "Received date" },
  "counterparty.jurisdiction": {
    id: "search.property.counterparty.jurisdiction",
    defaultMessage: "Jurisdiction",
  },
  "knowledge_item.type": { id: "search.property.knowledge_item.type", defaultMessage: "Type" },
  "knowledge_item.state": { id: "search.property.knowledge_item.state", defaultMessage: "State" },
  "knowledge_item.folder": {
    id: "search.property.knowledge_item.folder",
    defaultMessage: "Knowledge Folder",
  },
});
export function propertyLabel(intl: IntlShape, kind: string, key: string) {
  const label = PROPERTY_LABELS[`${kind}.${key}` as keyof typeof PROPERTY_LABELS];
  return label ? intl.formatMessage(label) : key;
}
export type Condition = SearchQuestion["conditions"][number];
type Choice = { id: string; displayName: string };
type Options = RecordFilterOptions & {
  counterparties?: Choice[];
  entities?: Choice[];
  businessOwners?: Choice[];
};
const EMPTY: Options = { types: [], statuses: [], people: [] };

export function useConditionDefinitions(
  kinds: SearchQuestion["kinds"],
  onFieldsLoaded?: (fields: SearchField[]) => void,
) {
  const intl = useIntl();
  const other = useOtherConditionDefinitions(kinds);
  const fields = useSearchFields(
    kinds.some((kind) => ["contract", "matter", "entity"].includes(kind)),
    onFieldsLoaded,
  );
  const contracts = kinds.includes("contract");
  const matters = kinds.includes("matter");
  const [loaded, setLoaded] = useState<{
    contract: Options;
    matter: Options;
    error: string | null;
  }>({ contract: EMPTY, matter: EMPTY, error: null });
  useEffect(() => {
    let live = true;
    async function read() {
      try {
        const [contract, matter] = await Promise.all([
          contracts ? api.GET("/api/v1/contracts/filter-options") : undefined,
          matters ? api.GET("/api/v1/matters/filter-options") : undefined,
        ]);
        const failure = [contract, matter].find((result) => result && !result.data);
        const error = failure
          ? ((await problem(failure)).detail ??
            intl.formatMessage({
              id: "search.choices.error",
              defaultMessage: "Condition choices could not load.",
            }))
          : null;
        if (live)
          setLoaded({ contract: contract?.data ?? EMPTY, matter: matter?.data ?? EMPTY, error });
      } catch {
        if (live)
          setLoaded({
            contract: EMPTY,
            matter: EMPTY,
            error: intl.formatMessage({
              id: "search.choices.error",
              defaultMessage: "Condition choices could not load.",
            }),
          });
      }
    }
    void read();
    return () => {
      live = false;
    };
  }, [contracts, matters, intl]);
  const contractFilters = useRecordFilterDefinitions("contracts", loaded.contract);
  const matterFilters = useRecordFilterDefinitions("matters", loaded.matter);
  const choices = (condition: Pick<Condition, "kind" | "property">): Choice[] => {
    if (condition.property.startsWith("field:"))
      return fields.choices(condition.kind, condition.property);
    if (condition.kind !== "contract" && condition.kind !== "matter")
      return other.choices(condition);
    const options = condition.kind === "contract" ? loaded.contract : loaded.matter;
    if (condition.property === "counterparty") return options.counterparties ?? [];
    if (condition.property === "entity") return options.entities ?? [];
    if (condition.property === "businessOwner")
      return [
        {
          id: "me",
          displayName: intl.formatMessage({ id: "recordFilters.me", defaultMessage: "Me" }),
        },
        {
          id: "unassigned",
          displayName: intl.formatMessage({
            id: "recordFilters.unassigned",
            defaultMessage: "Unassigned",
          }),
        },
        ...(options.businessOwners ?? []),
      ];
    const filter = (condition.kind === "contract" ? contractFilters : matterFilters).find(
      (filter) => filter.key === condition.property,
    );
    return filter?.kind === "choices" ? filter.choices : [];
  };
  return { choices, fields, error: loaded.error ?? other.error ?? fields.error };
}
