// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Term timeline card on the contract record (M16/2), drawn from the
 * V12/V13 "Timeframe" mock as the contracts grill left it (section I).
 *
 * **The card draws the record and nothing else.** Every mark on it is a
 * function of five stored columns and one derived date the seam already
 * answers (CTR-006): the term type, the effective date, the expiry, the
 * renewal period, the notice period, and the notice deadline. There is
 * no stored geometry and nothing to keep in step — a date edited on the
 * Contract card above moves the mark below it, because the mark was
 * never anything but that date.
 *
 * **The periods are the ones the dates imply.** A fixed term is one
 * period. An auto-renewing term is walked back from its expiry a
 * renewal period at a time, so the record's current expiry, its
 * effective date, and the roll length say between them where each
 * boundary falls. Rolls a person has confirmed are a different datum —
 * the log entries the confirmed roll writes (grill rows I.B3–I.B5) —
 * and they join the card with the slice that writes them.
 *
 * **Nothing draws a renewal cap** (grill rows G.R6 and I.B7). CTR-006
 * keeps no such column, and a card that drew one would be drawing a
 * field the model does not have.
 *
 * **Two marks cross the plot, and each says what it is where it
 * stands** (grill row I.X2): the today line with its pill, and the
 * derived notice deadline with the date it falls on. The key under the
 * plot names the fills; today needs no key entry, because its pill
 * already carries its name.
 *
 * **Labels sit in the gutter, never on the bars** (grill row I.X1): a
 * bar can be a few pixels wide on a narrow container, and a label
 * inside it would be the first thing to go. The gutter is also where
 * the card's readable content lives — each period's name and its two
 * dates — so the plot is a picture of text that is already on the page
 * rather than the only place a fact appears.
 *
 * **The empty states are honest.** An evergreen contract draws an open
 * period that runs off the end of the plot rather than an end the
 * record does not hold. A term whose dates are not set draws a line
 * naming the date it lacks, not a chart of nothing.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { ChevronsRight } from "lucide-react";
import { termPeriods, type ContractRow, type TermPeriod } from "../../lib/contracts";
import { civilToday, formatShortDate } from "../../lib/format";

/** Civil dates are calendar days, so the plot spans and compares them
 * as whole UTC days — never as instants, which a timezone could move
 * across a date boundary. */
const DAY_MS = 86_400_000;

function dayNumber(civil: string): number {
  // Fixed-width `YYYY-MM-DD`, so the three parts are slices rather than
  // a split whose length nothing guarantees.
  return (
    Date.UTC(Number(civil.slice(0, 4)), Number(civil.slice(5, 7)) - 1, Number(civil.slice(8, 10))) /
    DAY_MS
  );
}

function shiftDays(civil: string, days: number): string {
  return new Date((dayNumber(civil) + days) * DAY_MS).toISOString().slice(0, 10);
}

interface Scale {
  start: string;
  end: string;
}

/**
 * The span the plot covers.
 *
 * It is fit-to-term (grill row I.H3 removed the zoom switcher), widened
 * to hold every mark the card draws so none of them lands off the plot:
 * a contract whose term ran out last year still has to show where today
 * is. An open period gets room past its last known date for its bar to
 * run into — that room is scale, not a date, and the card never prints
 * it.
 */
function plotScale(periods: readonly TermPeriod[], marks: readonly string[]): Scale {
  const known = [
    ...periods.flatMap((period) =>
      period.end === null ? [period.start] : [period.start, period.end],
    ),
    ...marks,
  ];
  const start = known.reduce((earliest, date) => (date < earliest ? date : earliest));
  let end = known.reduce((latest, date) => (date > latest ? date : latest));
  if (periods.some((period) => period.end === null)) {
    end = shiftDays(end, Math.max(30, Math.round((dayNumber(end) - dayNumber(start)) * 0.15)));
  }
  // A term that starts and ends on one day would divide by zero; one
  // day is the narrowest scale that still draws.
  if (end <= start) end = shiftDays(start, 1);
  return { start, end };
}

/** How far across the plot a date falls, as a fraction clamped to it. */
function along(scale: Scale, date: string): number {
  const span = dayNumber(scale.end) - dayNumber(scale.start);
  return Math.min(1, Math.max(0, (dayNumber(date) - dayNumber(scale.start)) / span));
}

/** The same, as the CSS percentage an inset takes. */
function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(4)}%`;
}

/** A key swatch, filled the way the thing it stands for is filled. */
function Swatch({ fill }: { fill: string }) {
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-chip ${fill}`} />;
}

/** Which date the record is missing, which is what its empty line says.
 * An evergreen contract can hold no expiry, so it is never the end that
 * is missing there. */
function missingDate(contract: ContractRow): "start" | "end" | "both" {
  if (contract.effectiveDate !== null) return "end";
  if (contract.expiryDate !== null || contract.termType === "evergreen") return "start";
  return "both";
}

export function TermTimelineCard({ contract }: { contract: ContractRow }) {
  const periods = termPeriods(contract);

  return (
    <section
      aria-labelledby="contract-term-timeline-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id="contract-term-timeline-heading" className="text-base font-semibold">
          <FormattedMessage id="contracts.termTimeline.heading" defaultMessage="Term timeline" />
        </h2>
      </header>
      {periods.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="contracts.termTimeline.empty"
            defaultMessage="{missing, select, start {No effective date on this contract yet.} end {No expiry date on this contract yet.} other {No term dates on this contract yet.}}"
            values={{ missing: missingDate(contract) }}
          />
        </p>
      ) : (
        <TermPlot periods={periods} noticeDeadline={contract.noticeDeadline} />
      )}
    </section>
  );
}

function TermPlot({
  periods,
  noticeDeadline,
}: {
  periods: readonly TermPeriod[];
  noticeDeadline: string | null;
}) {
  const intl = useIntl();
  const today = civilToday();
  const scale = plotScale(periods, noticeDeadline === null ? [today] : [today, noticeDeadline]);
  const open = periods.some((period) => period.end === null);
  const rolls = periods.some((period) => period.renewal > 0);

  return (
    <div className="p-4">
      <div className="flex gap-3">
        {/* The gutter — the card's readable half. Each row names its
            period and gives the two dates the bar beside it spans, so
            the term reads whether or not the picture does. */}
        <ul
          aria-label={intl.formatMessage({
            id: "contracts.termTimeline.periods",
            defaultMessage: "Term periods",
          })}
          className="flex w-24 shrink-0 flex-col gap-1 pt-2 @2xl/page:w-48"
        >
          {periods.map((period) => (
            <li key={period.start} className="flex h-10 flex-col justify-center">
              <span className="text-base">
                <FormattedMessage
                  id="contracts.termTimeline.period"
                  defaultMessage="{renewal, plural, =0 {Initial term} other {Renewal #}}"
                  values={{ renewal: period.renewal }}
                />
              </span>
              <span className="text-xs text-muted">
                {period.end === null ? (
                  <FormattedMessage
                    id="contracts.termTimeline.openPeriodDates"
                    defaultMessage="From {start}"
                    values={{ start: formatShortDate(period.start) }}
                  />
                ) : (
                  <FormattedMessage
                    id="contracts.termTimeline.periodDates"
                    defaultMessage="{start} – {end}"
                    values={{
                      start: formatShortDate(period.start),
                      end: formatShortDate(period.end),
                    }}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative rounded-card bg-control pt-2 pb-7">
            {/* The bars repeat what the gutter already says, so they are
                the picture and the gutter is the reading. */}
            <ul aria-hidden className="flex flex-col gap-1">
              {periods.map((period) => (
                <li key={period.start} className="relative h-10">
                  <span
                    className={`absolute inset-y-2.5 flex items-center justify-end rounded-chip ${
                      period.renewal === 0 ? "bg-status-info-fg" : "bg-status-assigned-fg"
                    }`}
                    style={{
                      insetInlineStart: percent(along(scale, period.start)),
                      // A closed period is sized rather than pinned at
                      // both ends, so a one-day term still draws: a
                      // period whose two dates are the same is a hair
                      // of the scale wide, and a bar nobody can see
                      // would say the record holds no term at all.
                      ...(period.end === null
                        ? { insetInlineEnd: "0%" }
                        : {
                            inlineSize: `max(2px, ${percent(
                              along(scale, period.end) - along(scale, period.start),
                            )})`,
                          }),
                    }}
                  >
                    {/* An open period runs off the plot rather than
                        stopping on a date the record does not hold. */}
                    {period.end === null && (
                      <ChevronsRight className="size-4 text-status-info-bg" strokeWidth={2.5} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {noticeDeadline !== null && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-0.5 bg-status-severe-fg"
                  style={{ insetInlineStart: percent(along(scale, noticeDeadline)) }}
                />
                <span
                  className="absolute top-0 flex w-0 justify-center"
                  style={{ insetInlineStart: percent(along(scale, noticeDeadline)) }}
                >
                  <span className="rounded-chip bg-status-severe-bg px-1 text-xs font-medium text-status-severe-fg">
                    <span aria-hidden>{formatShortDate(noticeDeadline)}</span>
                    {/* The date alone is the mark's whole visible copy;
                        the key's swatch says which mark it is, and a
                        reader who cannot see the swatch is told here. */}
                    <span className="sr-only">
                      <FormattedMessage
                        id="contracts.termTimeline.noticeDeadlineOn"
                        defaultMessage="Notice deadline {date}"
                        values={{ date: formatShortDate(noticeDeadline) }}
                      />
                    </span>
                  </span>
                </span>
              </>
            )}
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 bg-status-success-fg"
              style={{ insetInlineStart: percent(along(scale, today)) }}
            />
            <span
              className="absolute bottom-1 flex w-0 justify-center"
              style={{ insetInlineStart: percent(along(scale, today)) }}
            >
              <span className="rounded-chip bg-status-success-bg px-1 text-xs font-medium text-status-success-fg">
                <FormattedMessage id="contracts.termTimeline.today" defaultMessage="Today" />
              </span>
            </span>
          </div>
          {/* The scale's two ends. An open term has no end to print, so
              it says so rather than printing the room its bar runs
              into. */}
          <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-muted">
            <span>{formatShortDate(scale.start)}</span>
            <span>
              {open ? (
                <FormattedMessage id="contracts.termTimeline.noEnd" defaultMessage="No end date" />
              ) : (
                formatShortDate(scale.end)
              )}
            </span>
          </div>
        </div>
      </div>
      {/* The key names the fills the plot uses and nothing else: a
          swatch for a family the card is not drawing would describe a
          rule it is not applying. */}
      <ul
        aria-label={intl.formatMessage({
          id: "contracts.termTimeline.key",
          defaultMessage: "Timeline key",
        })}
        className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
      >
        <li className="flex items-center gap-1.5">
          <Swatch fill="bg-status-info-fg" />
          <FormattedMessage id="contracts.termTimeline.keyInitial" defaultMessage="Initial term" />
        </li>
        {rolls && (
          <li className="flex items-center gap-1.5">
            <Swatch fill="bg-status-assigned-fg" />
            <FormattedMessage id="contracts.termTimeline.keyRolls" defaultMessage="Renewals" />
          </li>
        )}
        {noticeDeadline !== null && (
          <li className="flex items-center gap-1.5">
            <Swatch fill="bg-status-severe-fg" />
            <FormattedMessage
              id="contracts.termTimeline.keyNotice"
              defaultMessage="Notice deadline"
            />
          </li>
        )}
      </ul>
    </div>
  );
}
