// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import type { DatesHomeSection } from "../../lib/home";
import { DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import { Calendar } from "../ui/calendar";
import { Button } from "../ui/button";
import { HomeDateLink } from "./date-row";

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DatesCalendarDialog() {
  const intl = useIntl();
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState<Date>();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    from: string;
    rows: DatesHomeSection["rows"];
    failed: boolean;
  }>();
  const from = dateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const to = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const loading = answer?.from !== from;
  const rows = loading ? [] : answer.rows;
  const failed = !loading && answer.failed;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.date, (counts.get(row.date) ?? 0) + 1);
  const selectedKey = selected ? dateKey(selected) : undefined;
  const visibleRows = selectedKey ? rows.filter((row) => row.date === selectedKey) : rows;

  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET("/api/v1/home/dates", {
        params: { query: { from, to } },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!controller.signal.aborted) setAnswer({ from, rows: data?.rows ?? [], failed: !data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswer({ from, rows: [], failed: true });
      });
    return () => controller.abort();
  }, [from, to, attempt]);

  function changeMonth(next: Date) {
    setMonth(next);
    setSelected(undefined);
  }

  return (
    <DialogContent width="wide" aria-describedby="home-calendar-description">
      <div className="mb-1 flex items-center justify-between gap-3">
        <DialogTitle>
          <FormattedMessage id="home.dates.calendarTitle" defaultMessage="Your dates" />
        </DialogTitle>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={intl.formatMessage({
              id: "home.dates.closeCalendar",
              defaultMessage: "Close calendar",
            })}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </DialogClose>
      </div>
      <p id="home-calendar-description" className="mb-4 text-sm text-muted">
        <FormattedMessage
          id="home.dates.calendarDescription"
          defaultMessage="Key dates, term expiries and renewal notice deadlines on your Contracts and Matters."
        />
      </p>
      <div className="rounded-card border border-border-default p-3">
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={intl.formatMessage({
                id: "home.dates.previousMonth",
                defaultMessage: "Previous month",
              })}
              className="justify-self-center"
              onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </Button>
            <h3 className="text-center text-lg font-semibold" aria-live="polite">
              {intl.formatDate(month, { month: "long", year: "numeric" })}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label={intl.formatMessage({
                id: "home.dates.nextMonth",
                defaultMessage: "Next month",
              })}
              className="justify-self-center"
              onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const today = new Date();
              changeMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(today);
            }}
          >
            <FormattedMessage id="home.dates.today" defaultMessage="Today" />
          </Button>
        </div>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={changeMonth}
          selected={selected}
          onSelect={setSelected}
          showOutsideDays={false}
          hideNavigation
          className="w-full p-0"
          style={
            {
              "--rdp-accent-color": "var(--cta-primary)",
              "--rdp-today-color": "var(--text-link)",
              "--rdp-day-height": "3.5rem",
              "--rdp-day_button-height": "3rem",
              "--rdp-day_button-width": "min(3rem, 100%)",
              "--rdp-day_button-border-radius": "var(--radius-button)",
              "--rdp-selected-border": "2px solid var(--cta-primary)",
            } as CSSProperties
          }
          classNames={{
            months: "rdp-months w-full max-w-none",
            month: "rdp-month w-full",
            month_grid: "rdp-month_grid w-full table-fixed",
            month_caption: "hidden",
            weekday: "rdp-weekday text-center! text-md! font-medium text-muted",
            day: "rdp-day p-0! text-center",
            day_button:
              "rdp-day_button mx-auto! text-lg! hover:bg-section-header focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link",
            selected:
              "rdp-selected font-medium! text-lg! [&_button]:border-transparent! [&_button]:bg-cta-primary! [&_button]:text-on-cta!",
          }}
          modifiers={{ hasDates: (date) => counts.has(dateKey(date)) }}
          modifiersClassNames={{
            hasDates:
              "[&_button]:relative [&_button]:after:absolute [&_button]:after:bottom-1 [&_button]:after:size-1 [&_button]:after:rounded-full [&_button]:after:bg-current [&_button]:after:content-['']",
          }}
          labels={{
            labelDayButton: (date) =>
              intl.formatMessage(
                {
                  id: "home.dates.calendarDay",
                  defaultMessage:
                    "{date} — {count, plural, =0 {no dates} one {# date} other {# dates}}",
                },
                {
                  date: intl.formatDate(date, { dateStyle: "full" }),
                  count: counts.get(dateKey(date)) ?? 0,
                },
              ),
          }}
        />
      </div>
      <div className="mt-4 flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          {selected ? (
            intl.formatDate(selected, { dateStyle: "long" })
          ) : (
            <FormattedMessage id="home.dates.thisMonth" defaultMessage="This month" />
          )}
          {!loading && !failed ? (
            <span className="ms-2 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs text-badge-count-fg">
              {visibleRows.length}
            </span>
          ) : null}
        </h3>
        {selected ? (
          <Button variant="link" size="sm" onClick={() => setSelected(undefined)}>
            <FormattedMessage id="home.dates.showMonth" defaultMessage="Show whole month" />
          </Button>
        ) : null}
      </div>
      <div
        aria-busy={loading}
        className="mt-2 max-h-64 overflow-y-auto rounded-card border border-border-default"
      >
        {loading ? (
          <p role="status" className="p-4 text-muted">
            <FormattedMessage id="home.dates.loading" defaultMessage="Loading dates…" />
          </p>
        ) : failed ? (
          <div className="space-y-2 p-4">
            <p role="alert">
              <FormattedMessage
                id="home.dates.loadFailed"
                defaultMessage="Dates could not be loaded."
              />
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setAnswer(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              <FormattedMessage id="home.dates.retry" defaultMessage="Try again" />
            </Button>
          </div>
        ) : visibleRows.length === 0 ? (
          <p role="status" className="p-4 text-muted">
            <FormattedMessage id="home.dates.none" defaultMessage="No dates in this period." />
          </p>
        ) : (
          <ul className="divide-y divide-border-muted">
            {visibleRows.map((row) => (
              <li
                key={`${row.record.kind}:${row.record.id}:${row.source}:${row.keyDateId ?? "derived"}`}
              >
                <HomeDateLink row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </DialogContent>
  );
}
