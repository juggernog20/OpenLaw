// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity record's Share capital card: ENT-001's three simple
 * columns (authorized shares, issued shares, par value in minor
 * units), each committed on its own per DES-017.
 *
 * All three columns are whole numbers of zero or more. A blank draft
 * clears the column to null. A draft that is not a whole number never
 * leaves the card. The refusal shows beside the box until the next
 * commit or Escape clears it.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { EntityRow } from "../../lib/entities";
import type { FieldStatus } from "../../lib/field-commit";
import { StatusNote } from "../status-note";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type CapitalKey = "sharesAuthorized" | "sharesIssued" | "parValue";

const CAPITAL_FIELDS: readonly {
  key: CapitalKey;
  label: React.ReactNode;
}[] = [
  {
    key: "sharesAuthorized",
    label: (
      <FormattedMessage
        id="entities.record.shareCapital.authorized"
        defaultMessage="Authorized shares"
      />
    ),
  },
  {
    key: "sharesIssued",
    label: (
      <FormattedMessage id="entities.record.shareCapital.issued" defaultMessage="Issued shares" />
    ),
  },
  {
    key: "parValue",
    label: (
      <FormattedMessage
        id="entities.record.shareCapital.parValue"
        defaultMessage="Par value (minor units)"
      />
    ),
  },
];

export function ShareCapitalCard({
  entity,
  frozen,
  status,
  error,
  onCommit,
}: Readonly<{
  entity: EntityRow;
  frozen: boolean;
  status: Partial<Record<CapitalKey, FieldStatus>>;
  error: Partial<Record<CapitalKey, string | undefined>>;
  onCommit: (key: CapitalKey, value: number | null) => void;
}>) {
  const intl = useIntl();
  const [drafts, setDrafts] = useState<Record<CapitalKey, string>>(() => capitalDrafts(entity));
  // Refusals the card raised itself, without a request. One overrides
  // the commit status of its column until the next commit or Escape.
  const [refusals, setRefusals] = useState<Partial<Record<CapitalKey, string>>>({});
  function refuse(key: CapitalKey, detail?: string) {
    setRefusals((current) => ({ ...current, [key]: detail }));
  }
  function commit(key: CapitalKey) {
    const draft = drafts[key].trim();
    const saved = entity[key];
    if (draft === "") {
      refuse(key, undefined);
      if (saved !== null) onCommit(key, null);
      return;
    }
    const value = Number(draft);
    if (!Number.isSafeInteger(value) || value < 0) {
      refuse(
        key,
        intl.formatMessage({
          id: "entities.record.shareCapital.invalid",
          defaultMessage: "Enter a whole number of zero or more.",
        }),
      );
      return;
    }
    refuse(key, undefined);
    if (value !== saved) onCommit(key, value);
  }

  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">
          <FormattedMessage
            id="entities.record.shareCapital.title"
            defaultMessage="Share capital"
          />
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-3">
        {CAPITAL_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`entity-${key}`}>{label}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`entity-${key}`}
                type="number"
                min={0}
                step={1}
                value={drafts[key]}
                disabled={frozen}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [key]: event.target.value }))
                }
                onBlur={() => commit(key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit(key);
                  if (event.key === "Escape") {
                    setDrafts((current) => ({ ...current, [key]: String(entity[key] ?? "") }));
                    refuse(key, undefined);
                  }
                }}
              />
              <StatusNote
                status={refusals[key] === undefined ? (status[key] ?? "idle") : "error"}
                detail={refusals[key] ?? error[key]}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function capitalDrafts(entity: EntityRow): Record<CapitalKey, string> {
  return {
    sharesAuthorized: String(entity.sharesAuthorized ?? ""),
    sharesIssued: String(entity.sharesIssued ?? ""),
    parValue: String(entity.parValue ?? ""),
  };
}

export type { CapitalKey };
