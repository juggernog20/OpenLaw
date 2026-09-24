// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Relative search dates resolve in the viewer's calendar (DES-014).
 * Ranges include both endpoints. Weeks run Monday to Sunday; rolling ranges
 * include today and the day N days away.
 */
import { isRelativeDateOperator } from "@openlaw/shared";
import { localMoment } from "../../lib/notifications/local-day.js";

export function relativeDateRange(
  operator: string,
  value: unknown,
  now: Date,
  timeZone: string,
): [string, string] | null {
  if (!isRelativeDateOperator(operator)) return null;
  // The viewer's civil date, held as UTC midnight so the day arithmetic
  // below never crosses a daylight saving change.
  const today = new Date(`${localMoment(now, timeZone).date}T00:00:00Z`);
  const from = new Date(today);
  const to = new Date(today);
  switch (operator) {
    case "in_last_days":
      from.setUTCDate(from.getUTCDate() - (value as number));
      break;
    case "in_next_days":
      to.setUTCDate(to.getUTCDate() + (value as number));
      break;
    case "this_week":
      from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
      to.setTime(from.getTime());
      to.setUTCDate(to.getUTCDate() + 6);
      break;
    case "this_month":
      from.setUTCDate(1);
      to.setUTCMonth(to.getUTCMonth() + 1, 0);
      break;
    case "this_quarter": {
      const month = Math.floor(today.getUTCMonth() / 3) * 3;
      from.setUTCMonth(month, 1);
      to.setUTCMonth(month + 3, 0);
      break;
    }
    case "this_year":
      from.setUTCMonth(0, 1);
      to.setUTCMonth(11, 31);
      break;
  }
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}
