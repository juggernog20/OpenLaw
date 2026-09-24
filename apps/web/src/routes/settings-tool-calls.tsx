// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Download } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { dayBounds, formatLongDateTime } from "../lib/format";
import { requireUser } from "../lib/session";
import { AuditSettingsTabs } from "../components/audit-settings-tabs";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type Page =
  paths["/api/v1/audit-log/tool-calls"]["get"]["responses"]["200"]["content"]["application/json"];
export async function settingsToolCallsLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const lastDay = new URL(request.url).searchParams.get("range") === "last-day";
  const now = Date.now();
  return {
    window: lastDay
      ? { from: new Date(now - 86_400_000).toISOString(), to: new Date(now).toISOString() }
      : null,
  };
}

export function SettingsToolCallsPage() {
  const loaded = useLoaderData<typeof settingsToolCallsLoader>();
  const intl = useIntl();
  const [dates, setDates] = useState({ from: "", to: "", useWindow: true });
  const query = useMemo<Record<string, string>>(() => {
    if (dates.useWindow && loaded.window) return loaded.window;
    const from = dayBounds(dates.from);
    const to = dayBounds(dates.to);
    return { ...(from ? { from: from.start } : {}), ...(to ? { to: to.end } : {}) };
  }, [dates, loaded.window]);
  const key = JSON.stringify(query);
  const [page, setPage] = useState<{ key: string; data: Page } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const current = page?.key === key ? page.data : null;
  const load = useCallback(
    (cursor?: string) => {
      const mine = ++generation.current;
      return api
        .GET("/api/v1/audit-log/tool-calls", {
          params: { query: { ...query, ...(cursor ? { cursor } : {}) } },
        })
        .catch(() => ({ data: undefined }))
        .then(({ data }) => {
          if (mine !== generation.current) return;
          setBusy(false);
          if (!data) {
            setFailed(key);
            return;
          }
          setFailed(null);
          setPage((previous) => ({
            key,
            data: {
              ...data,
              entries:
                cursor && previous?.key === key
                  ? [...previous.data.entries, ...data.entries]
                  : data.entries,
            },
          }));
        });
    },
    [query, key],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const title = intl.formatMessage({ id: "audit.toolCalls", defaultMessage: "Tool calls" });
  return (
    <>
      <PageTitle title={title} />
      <AuditSettingsTabs />
      <SettingsCard
        title={title}
        className="max-w-none"
        flush
        actions={
          <Button asChild size="sm" variant="secondary">
            <a download href={`/api/v1/audit-log/tool-calls/export?${new URLSearchParams(query)}`}>
              <Download size={16} aria-hidden="true" />
              <FormattedMessage id="audit.export" defaultMessage="Export CSV" />
            </a>
          </Button>
        }
      >
        <div
          role="search"
          aria-label={intl.formatMessage({
            id: "audit.toolCalls.filters",
            defaultMessage: "Narrow Tool calls",
          })}
          className="flex flex-wrap items-end gap-3 border-b border-border-default px-4 py-3"
        >
          {(["from", "to"] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <Label htmlFor={`tool-calls-${field}`}>
                {field === "from" ? (
                  <FormattedMessage id="audit.filter.from" defaultMessage="From" />
                ) : (
                  <FormattedMessage id="audit.filter.to" defaultMessage="To" />
                )}
              </Label>
              <Input
                id={`tool-calls-${field}`}
                type="date"
                value={dates[field]}
                onChange={(event) =>
                  setDates((previous) => ({
                    ...previous,
                    [field]: event.target.value,
                    useWindow: false,
                  }))
                }
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDates({ from: "", to: "", useWindow: false })}
          >
            <FormattedMessage id="audit.filter.clear" defaultMessage="Clear filters" />
          </Button>
          {dates.useWindow && loaded.window && (
            <p className="text-sm text-muted">
              <FormattedMessage
                id="audit.toolCalls.lastDay"
                defaultMessage="Last 24 hours: {from} to {to}"
                values={{
                  from: formatLongDateTime(loaded.window.from),
                  to: formatLongDateTime(loaded.window.to),
                }}
              />
            </p>
          )}
        </div>
        {failed === key && (
          <div role="alert" className="px-4 py-3 text-status-danger-fg">
            <FormattedMessage
              id="audit.toolCalls.error"
              defaultMessage="Tool calls could not be read."
            />{" "}
            <Button variant="secondary" onClick={() => void load(current?.nextCursor ?? undefined)}>
              <FormattedMessage id="audit.toolCalls.retry" defaultMessage="Retry" />
            </Button>
          </div>
        )}
        {!current && failed !== key && (
          <p role="status" className="px-4 py-3 text-muted">
            <FormattedMessage id="audit.toolCalls.loading" defaultMessage="Loading Tool calls…" />
          </p>
        )}
        {current?.entries.length === 0 && (
          <p className="px-4 py-3 text-muted">
            <FormattedMessage
              id="audit.toolCalls.empty"
              defaultMessage="No Tool calls match these filters."
            />
          </p>
        )}
        {current && current.entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-default bg-control text-xs text-muted">
                <tr>
                  <th scope="col" className="h-9 px-4">
                    <FormattedMessage id="audit.col.when" defaultMessage="When" />
                  </th>
                  <th scope="col" className="h-9 px-4">
                    <FormattedMessage id="audit.filter.actor" defaultMessage="Person" />
                  </th>
                  <th scope="col" className="h-9 px-4">
                    <FormattedMessage id="audit.toolCalls.client" defaultMessage="Client" />
                  </th>
                  <th scope="col" className="h-9 px-4">
                    <FormattedMessage id="audit.toolCalls.tool" defaultMessage="Tool" />
                  </th>
                  <th scope="col" className="h-9 px-4">
                    <FormattedMessage id="audit.toolCalls.outcomeLabel" defaultMessage="Outcome" />
                  </th>
                  <th scope="col" className="h-9 px-4">
                    <FormattedMessage
                      id="audit.toolCalls.durationLabel"
                      defaultMessage="Duration"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border-muted last:border-b-0">
                    <td className="px-4 py-3">
                      <time dateTime={entry.createdAt}>{formatLongDateTime(entry.createdAt)}</time>
                    </td>
                    <td className="px-4 py-3">{entry.person.displayName}</td>
                    <td className="px-4 py-3">{entry.clientName}</td>
                    <td className="px-4 py-3 font-mono">{entry.tool}</td>
                    <td className="px-4 py-3">
                      <FormattedMessage
                        id="audit.toolCalls.outcome"
                        defaultMessage="{outcome, select, success {Success} pending {Pending} rate_limited {Rate limited} forbidden {Forbidden} tool_outside_grant {Outside the grant} mcp_read_only {Read-only} unknown_tool {Unknown Tool} invalid_arguments {Invalid arguments} invalid_cursor {Invalid cursor} validation_error {Validation error} not_found {Not found} type_not_found {Type not found} article_not_found {Article not found} unavailable {Unavailable} form_unavailable {Form unavailable} documentation_unavailable {Documentation unavailable} acknowledgement_required {Acknowledgement required} generation_limit_reached {Generation limit reached} result_too_large {Result too large} internal_error {Internal error} other {{outcome}}}"
                        values={{ outcome: entry.outcome }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <FormattedMessage
                        id="audit.toolCalls.duration"
                        defaultMessage="{duration, number} ms"
                        values={{ duration: entry.durationMs }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {current?.nextCursor && (
          <div className="px-4 py-3">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void load(current.nextCursor!);
              }}
            >
              <FormattedMessage id="audit.toolCalls.more" defaultMessage="Load more" />
            </Button>
          </div>
        )}
      </SettingsCard>
    </>
  );
}
