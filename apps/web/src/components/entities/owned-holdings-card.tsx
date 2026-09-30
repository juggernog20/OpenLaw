// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Holdings in other Entities" on the Ownership tab (ENT-003). Every row
 * is projected from the owned Entity's share register (ENT-012), so the
 * card only reads. The pill on a row leads to the register that made it.
 */
import { useId } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import type { EntityHolding } from "../../lib/entities";
import { RestrictedRecordCell } from "../restricted-record-cell";

export function OwnedHoldingsCard({ rows }: Readonly<{ rows: EntityHolding[] }>) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 id={headingId} className="text-base font-semibold">
          <FormattedMessage
            id="entities.register.ownedTitle"
            defaultMessage="Holdings in other Entities"
          />
        </h2>
      </header>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          <FormattedMessage
            id="entities.ownership.noneOwned"
            defaultMessage="This Entity owns no other Entities. A Holding appears here when the share register of another Entity records shares for this Entity."
          />
        </p>
      ) : (
        <ul className="divide-y divide-border-default">
          {rows.map((row, index) => (
            <HoldingRow
              key={row.owned.restricted ? `restricted-${index}` : row.owned.id}
              row={row}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HoldingRow({ row }: Readonly<{ row: EntityHolding }>) {
  const intl = useIntl();
  const owned = row.owned;
  if (owned.restricted) {
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
      <Link to={`/entities/${owned.id}`} className="min-w-0 flex-1 truncate font-medium text-link">
        {owned.legalName}
      </Link>
      <Link
        to={`/entities/${owned.id}/ownership`}
        className="rounded-pill bg-status-info-bg px-2 py-0.5 text-xs font-medium text-status-info-fg"
        title={intl.formatMessage({
          id: "entities.ownership.fromRegisterHint",
          defaultMessage: "Derived from the share register. Record an entry there to change it.",
        })}
      >
        <FormattedMessage id="entities.ownership.fromRegister" defaultMessage="From register" />
      </Link>
      <span
        className="w-16 text-end text-sm tabular-nums"
        aria-label={intl.formatMessage(
          { id: "entities.ownership.rowPercent", defaultMessage: "{name} ownership percent" },
          { name: owned.legalName },
        )}
      >
        {/* The projection stores two decimals, so the row shows both. */}
        {intl.formatNumber(row.ownershipPercent / 100, {
          style: "percent",
          maximumFractionDigits: 2,
        })}
      </span>
    </li>
  );
}
