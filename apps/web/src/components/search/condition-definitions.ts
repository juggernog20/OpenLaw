// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { type SearchQuestion } from "@openlaw/shared";
import { defineMessages, useIntl, type IntlShape } from "react-intl";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import {
  useRecordFilterDefinitions,
  type RecordFilterOptions,
} from "../table/record-filter-definitions";

export const OPERATOR_LABELS = defineMessages({
  is_any_of: { id: "search.operator.any", defaultMessage: "is any of" },
  is_none_of: { id: "search.operator.none", defaultMessage: "is none of" },
  contains: { id: "search.operator.contains", defaultMessage: "contains" },
  does_not_contain: { id: "search.operator.notContains", defaultMessage: "does not contain" },
  is: { id: "search.operator.is", defaultMessage: "is" },
  before: { id: "search.operator.before", defaultMessage: "before" },
  after: { id: "search.operator.after", defaultMessage: "after" },
  on: { id: "search.operator.on", defaultMessage: "on" },
  between: { id: "search.operator.between", defaultMessage: "between" },
});
export function operatorLabel(intl: IntlShape, operator: string) {
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

export function useConditionDefinitions(kinds: SearchQuestion["kinds"]) {
  const intl = useIntl();
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
  return { choices, error: loaded.error };
}
