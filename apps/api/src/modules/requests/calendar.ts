// SPDX-License-Identifier: AGPL-3.0-only

/** INT-003: Request estimates use the organization's calendar, including across DST. */
import { orgSettings, type Executor } from "@openlaw/db";
import { shiftDays } from "../../lib/contract-term.js";

/** Count Monday–Friday after the submission date; no holiday calendar is configured. */
export function addBusinessDays(date: string, days: number): string {
  if (days === 0) return date;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  // Weekend submissions count from the preceding Friday, so day one is Monday.
  const weekendOffset = weekday === 0 ? -2 : weekday === 6 ? -1 : 0;
  const startDay = weekendOffset ? 5 : weekday;
  const remainder = days % 5;
  const offset = Math.floor(days / 5) * 7 + remainder + (startDay + remainder > 5 ? 2 : 0);
  return shiftDays(date, weekendOffset + offset);
}

export async function requestCalendar(db: Executor) {
  const [org] = await db
    .select({ timeZone: orgSettings.defaultTimezone })
    .from(orgSettings)
    .limit(1);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateOf = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const part = (name: string) => parts.find((part) => part.type === name)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  return {
    today: dateOf(new Date()),
    suggestedDate: (submitted: Date, days: number | null) =>
      days === null ? null : addBusinessDays(dateOf(submitted), days),
  };
}
