// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Filing history for one Obligation (ENT-006): each filing with its
 * date, who filed it, its note and the filed Document, newest first.
 * The rows come from the filing table, not from the History log.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { FileText } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityObligation, EntityObligationFiling } from "../../lib/entities";
import { formatFullDate } from "../../lib/format";
import { problem } from "../../lib/problem";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function FilingHistoryDialog({
  entityId,
  obligation,
  onClose,
}: Readonly<{ entityId: string; obligation: EntityObligation; onClose: () => void }>) {
  const intl = useIntl();
  const [filings, setFilings] = useState<EntityObligationFiling[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void api
      .GET("/api/v1/entities/{id}/obligations/{childId}/filings", {
        params: { path: { id: entityId, childId: obligation.id } },
      })
      .catch(() => undefined)
      .then(async (result) => {
        if (!live) return;
        if (result?.data) setFilings(result.data.filings);
        else setError((await problem(result)).detail);
      });
    return () => {
      live = false;
    };
  }, [entityId, obligation.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby="filing-history-obligation">
        <DialogTitle>
          <FormattedMessage
            id="entities.record.obligations.filingHistory"
            defaultMessage="Filing history"
          />
        </DialogTitle>
        <p id="filing-history-obligation" className="mt-1 text-sm text-muted">
          {obligation.label}
        </p>
        <div className="mt-4">
          {error ? (
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
          ) : filings === undefined ? (
            <p role="status" className="text-sm text-muted">
              <FormattedMessage
                id="entities.record.obligations.filingHistoryLoading"
                defaultMessage="Loading…"
              />
            </p>
          ) : filings.length === 0 ? (
            <p className="text-sm text-muted">
              <FormattedMessage
                id="entities.record.obligations.filingHistoryEmpty"
                defaultMessage="No filings yet."
              />
            </p>
          ) : (
            <ol className="divide-y divide-border-default rounded-card border border-border-default">
              {filings.map((filing) => (
                <li key={filing.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                  <span>
                    <FormattedMessage
                      id="entities.record.obligations.filedOnBy"
                      defaultMessage="{date} · Filed by {name}"
                      values={{
                        date: (
                          <time dateTime={filing.filedOn} className="font-medium">
                            {formatFullDate(filing.filedOn)}
                          </time>
                        ),
                        name: filing.filedBy.displayName,
                      }}
                    />
                  </span>
                  {filing.note ? (
                    <p className="whitespace-pre-wrap break-words text-primary">{filing.note}</p>
                  ) : null}
                  {filing.document === null ? null : "removed" in filing.document ? (
                    <span className="text-muted">
                      <FormattedMessage
                        id="entities.record.obligations.documentRemoved"
                        defaultMessage="Document removed"
                      />
                    </span>
                  ) : (
                    <Link
                      className="flex w-fit min-w-0 items-center gap-1.5 text-link hover:underline"
                      to={`/entities/${entityId}/documents?${new URLSearchParams({
                        doc: filing.document.id,
                        version: filing.document.versionId,
                      })}`}
                    >
                      <FileText size={16} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">{filing.document.title}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {intl.formatMessage({ id: "common.close", defaultMessage: "Close" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
