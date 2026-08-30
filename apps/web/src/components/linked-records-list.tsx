// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { defineMessage, FormattedMessage } from "react-intl";
import { Link } from "react-router";
import type { RecordReference } from "./record-context";
import { RestrictedRecordCell } from "./restricted-record-cell";
import type { LinkedRecord, LinkedRecordsSeam } from "../lib/linked-records";

const RESTRICTED = defineMessage({
  id: "linkedRecords.restricted",
  defaultMessage: "Restricted record",
});

export function LinkedRecordsList({
  record,
  seam,
}: Readonly<{
  record: RecordReference;
  seam: LinkedRecordsSeam;
}>) {
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
      aria-label={seam.kind === "contract" ? "Contracts" : "Matters"}
      data-record={`${record.kind}:${record.id}`}
      data-api-seam={seam.kind}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">
          {seam.kind === "contract" ? (
            <FormattedMessage id="entities.linked.contracts" defaultMessage="Contracts" />
          ) : (
            <FormattedMessage id="entities.linked.matters" defaultMessage="Matters" />
          )}
        </h2>
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
