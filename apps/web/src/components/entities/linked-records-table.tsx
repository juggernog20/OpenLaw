// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts and Matters tabs on an Entity record. Each reads the
 * linked-records route with the main list's sort and cursor, and shows
 * the rows with the main list's column catalogue.
 */
import { useEffect, useRef, useState } from "react";
import { defineMessage, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { CONTRACT_SORT_KEYS, MATTER_SORT_KEYS } from "@openlaw/shared";
import { api } from "../../lib/api";
import { builtInLayout, type Layout, type TableCatalogue } from "../../lib/list-views";
import { CONTRACTS_CATALOGUE } from "../contracts/contracts-columns";
import { MATTERS_CATALOGUE } from "../matters/matters-columns";
import { ManagedTable } from "../table/managed-table";
import { ColumnMenu } from "../table/column-menu";
import { Button } from "../ui/button";

type Page<Row> = { records: Row[]; total: number; nextCursor: string | null };
type ReadPage<Row> = (
  entityId: string,
  sort: Layout["sort"],
  cursor?: string,
) => Promise<Page<Row>>;

async function readContracts(id: string, sort: Layout["sort"], cursor?: string) {
  const { data } = await api.GET("/api/v1/entities/{id}/contracts", {
    params: {
      path: { id },
      query: {
        cursor,
        sort: CONTRACT_SORT_KEYS.find((key) => key === sort?.key),
        dir: sort?.dir,
      },
    },
  });
  if (!data) throw new Error("Could not read entity contracts.");
  return data;
}
async function readMatters(id: string, sort: Layout["sort"], cursor?: string) {
  const { data } = await api.GET("/api/v1/entities/{id}/matters", {
    params: {
      path: { id },
      query: {
        cursor,
        sort: MATTER_SORT_KEYS.find((key) => key === sort?.key),
        dir: sort?.dir,
      },
    },
  });
  if (!data) throw new Error("Could not read entity matters.");
  return data;
}

export function EntityContractsTable({ entityId }: { entityId: string }) {
  return (
    <LinkedTable
      entityId={entityId}
      catalogue={CONTRACTS_CATALOGUE}
      read={readContracts}
      title={defineMessage({ id: "entities.linked.contracts", defaultMessage: "Contracts" })}
    />
  );
}
export function EntityMattersTable({ entityId }: { entityId: string }) {
  return (
    <LinkedTable
      entityId={entityId}
      catalogue={MATTERS_CATALOGUE}
      read={readMatters}
      title={defineMessage({ id: "entities.linked.matters", defaultMessage: "Matters" })}
    />
  );
}

function LinkedTable<Row extends { id: string }>({
  entityId,
  catalogue,
  read,
  title,
}: {
  entityId: string;
  catalogue: TableCatalogue<Row>;
  read: ReadPage<Row>;
  title: MessageDescriptor;
}) {
  const intl = useIntl();
  const [layout, setLayout] = useState(() => builtInLayout(catalogue));
  const [page, setPage] = useState<Page<Row> | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  /** The first row of the page Show more appended. Focus lands there. */
  const [appended, setAppended] = useState<string>();
  const request = useRef<{ cancelled: boolean } | null>(null);
  const sortKey = layout.sort?.key;
  const sortDir = layout.sort?.dir;
  useEffect(() => {
    const turn = { cancelled: false };
    request.current = turn;
    void read(entityId, sortKey && sortDir ? { key: sortKey, dir: sortDir } : null)
      .then((next) => {
        if (!turn.cancelled) setPage(next);
      })
      .catch(() => {
        if (!turn.cancelled) setFailed(true);
      })
      .finally(() => {
        if (!turn.cancelled) setBusy(false);
      });
    return () => {
      turn.cancelled = true;
    };
  }, [entityId, read, sortKey, sortDir, retry]);

  function changeLayout(next: Layout) {
    if (next.sort?.key !== layout.sort?.key || next.sort?.dir !== layout.sort?.dir) {
      if (request.current) request.current.cancelled = true;
      setPage(null);
      setAppended(undefined);
      setBusy(true);
      setFailed(false);
    }
    setLayout(next);
  }

  async function more() {
    if (!page?.nextCursor || busy) return;
    const turn = request.current;
    if (!turn) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await read(entityId, layout.sort, page.nextCursor);
      if (!turn.cancelled) {
        const fresh = next.records.filter(
          (row) => !page.records.some((known) => known.id === row.id),
        );
        setPage({ ...next, records: [...page.records, ...fresh] });
        if (fresh[0]) setAppended(fresh[0].id);
      }
    } catch {
      if (!turn.cancelled) setFailed(true);
    } finally {
      if (!turn.cancelled) setBusy(false);
    }
  }

  return (
    <section
      aria-label={intl.formatMessage(title)}
      aria-busy={busy}
      className="flex min-w-0 flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{intl.formatMessage(title)}</h2>
          {page && <span className="text-sm text-muted">{intl.formatNumber(page.total)}</span>}
        </div>
        <ColumnMenu catalogue={catalogue} layout={layout} onLayoutChange={changeLayout} />
      </header>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-sm text-status-danger-fg">
          <FormattedMessage
            id="entities.linked.failed"
            defaultMessage="The linked records could not be read."
          />
          {!page && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailed(false);
                setBusy(true);
                setRetry((value) => value + 1);
              }}
            >
              <FormattedMessage id="common.retry" defaultMessage="Try again" />
            </Button>
          )}
        </div>
      )}
      {!page ? (
        busy && (
          <p role="status" className="text-sm text-muted">
            <FormattedMessage
              id="entities.linked.loading"
              defaultMessage="Loading linked records…"
            />
          </p>
        )
      ) : page.records.length === 0 ? (
        <p className="rounded-card border border-border-default bg-raised p-4 text-sm text-muted">
          <FormattedMessage id="entities.linked.empty" defaultMessage="No linked records." />
        </p>
      ) : (
        <ManagedTable
          catalogue={catalogue}
          layout={layout}
          rows={page.records}
          rowKey={(row) => row.id}
          onLayoutChange={changeLayout}
          focusRowKey={appended}
          foot={
            page.nextCursor ? (
              <Button variant="secondary" disabled={busy} onClick={() => void more()}>
                <FormattedMessage id="entities.linked.more" defaultMessage="Show more" />
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
