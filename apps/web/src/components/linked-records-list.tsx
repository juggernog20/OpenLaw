// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One roll-up list on the Entity record (ENT-007): the Contracts or
 * Matters that name this Entity, read through a `LinkedRecordsSeam`
 * (TECH-025).
 *
 * The record loader supplies only the tab counts. The rows are read
 * here, on mount, through the seam, so a tab that is never opened
 * costs no read. A row the reader cannot reach comes back restricted
 * and draws as a Restricted record cell, never as a gap.
 */

import { useEffect, useState } from "react";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";
import type { RecordReference } from "./record-context";
import { RestrictedRecordCell } from "./restricted-record-cell";
import type { LinkedRecord, LinkedRecordsSeam } from "../lib/linked-records";

const RESTRICTED = defineMessage({
  id: "linkedRecords.restricted",
  defaultMessage: "Restricted record",
});
const TITLES = {
  contract: defineMessage({ id: "entities.linked.contracts", defaultMessage: "Contracts" }),
  matter: defineMessage({ id: "entities.linked.matters", defaultMessage: "Matters" }),
} as const;

export function LinkedRecordsList({
  record,
  seam,
}: Readonly<{
  record: RecordReference;
  seam: LinkedRecordsSeam;
}>) {
  const intl = useIntl();
  const [rows, setRows] = useState<readonly (LinkedRecord | { restricted: true })[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void seam
      .read(record.id)
      .then((records) => {
        if (current) setRows(records);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [record.id, seam]);

  return (
    <section
      aria-label={intl.formatMessage(TITLES[seam.kind])}
      data-record={`${record.kind}:${record.id}`}
      data-api-seam={seam.kind}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">{intl.formatMessage(TITLES[seam.kind])}</h2>
      </header>
      {failed ? (
        <p className="p-4 text-sm text-danger">
          <FormattedMessage
            id="entities.linked.failed"
            defaultMessage="The linked records could not be read."
          />
        </p>
      ) : rows === null ? (
        <p className="p-4 text-sm text-muted">
          <FormattedMessage id="entities.linked.loading" defaultMessage="Loading linked records…" />
        </p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          <FormattedMessage id="entities.linked.empty" defaultMessage="No linked records." />
        </p>
      ) : (
        <ul className="divide-y divide-border-default">
          {rows.map((row, index) =>
            row.restricted ? (
              <RestrictedRecordCell
                key={`restricted-${index}`}
                as="li"
                label={RESTRICTED}
                className="p-4"
              />
            ) : (
              <li key={row.id}>
                <Link
                  to={`/${row.kind === "contract" ? "contracts" : "matters"}/${row.number}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-hover"
                >
                  <span className="min-w-0">
                    <span className="text-xs text-muted">
                      {row.kind === "contract" ? `C-${row.number}` : `M-${row.number}`}
                    </span>
                    <span className="block truncate text-sm font-medium text-primary">
                      {row.title}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{row.statusName}</span>
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
