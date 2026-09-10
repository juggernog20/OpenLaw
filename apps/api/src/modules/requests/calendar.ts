// SPDX-License-Identifier: AGPL-3.0-only

/** INT-003: Request estimates use the organization’s calendar, including across DST. */
import { orgSettings, type Executor } from "@openlaw/db";
import { shiftDays } from "../../lib/contract-term.js";

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
      days === null ? null : shiftDays(dateOf(submitted), days),
  };
}
