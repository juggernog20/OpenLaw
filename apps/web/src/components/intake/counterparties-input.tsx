// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import {
  CounterpartyPicker,
  type CounterpartyPick,
  type CounterpartyOption,
} from "../counterparty-picker";
import { Button } from "../ui/button";
import { api } from "../../lib/api";

export type IntakeCounterpartySelection = { pick: CounterpartyPick; label: string };

export function IntakeCounterpartiesInput({
  id,
  requestTypeId,
  selections,
  onChange,
  invalid,
  describedBy,
  required,
  searchOptions,
}: Readonly<{
  id: string;
  requestTypeId: string;
  searchOptions?: (query: string) => Promise<CounterpartyOption[]>;
  selections: readonly IntakeCounterpartySelection[];
  onChange: (value: IntakeCounterpartySelection[]) => void;
  invalid?: boolean;
  required?: boolean;
  describedBy?: string;
}>) {
  const intl = useIntl();
  const search = useCallback(
    async (query: string) => {
      if (searchOptions) return searchOptions(query);
      const { data } = await api.GET("/api/v1/portal/request-types/{id}/counterparties", {
        params: { path: { id: requestTypeId }, query: { query } },
      });
      if (!data) throw new Error("Counterparty search failed");
      return data.counterparties;
    },
    [requestTypeId, searchOptions],
  );
  return (
    <div className="flex flex-col gap-2">
      {selections.length > 0 && (
        <ul className="flex flex-col gap-1">
          {selections.map((selection, index) => (
            <li
              key={
                "counterpartyId" in selection.pick
                  ? selection.pick.counterpartyId
                  : `new:${selection.pick.name}`
              }
              className="flex min-w-0 items-center gap-2 rounded-button border border-border-default px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{selection.label}</span>
              {index === 0 && (
                <span className="text-xs text-muted">
                  <FormattedMessage id="intake.counterparties.primary" defaultMessage="Primary" />
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={intl.formatMessage(
                  { id: "intake.counterparties.remove", defaultMessage: "Remove {name}" },
                  { name: selection.label },
                )}
                onClick={() => {
                  onChange(selections.filter((_, selectedIndex) => selectedIndex !== index));
                  document.getElementById(id)?.focus();
                }}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <CounterpartyPicker
        required={required}
        excludeNames={selections.map((selection) => selection.label)}
        id={id}
        search={search}
        invalid={invalid}
        describedBy={describedBy}
        addNewLabel
        disabled={selections.length >= 50}
        exclude={selections.flatMap((selection) =>
          "counterpartyId" in selection.pick ? [selection.pick.counterpartyId] : [],
        )}
        onPick={(pick, label) => {
          if (
            selections.some(
              (selection) =>
                "name" in pick &&
                "name" in selection.pick &&
                selection.pick.name.toLocaleLowerCase() === pick.name.toLocaleLowerCase(),
            )
          )
            return;
          onChange([...selections, { pick, label }]);
        }}
      />
    </div>
  );
}
