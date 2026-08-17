// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drive the shared DatePicker from tests: open the labelled trigger,
 * jump the month/year dropdowns, pick a day. The accessible names are
 * the ones DatePicker sets (DES-048).
 *
 * **Render the picker under `en-US`.** Everything below is English by
 * construction: the month names, the "Month" and "Year" names on the
 * two dropdowns, and the ordinal day name React DayPicker gives each
 * day button. A test that renders the picker under another locale finds
 * none of them. That is a limit of this helper, not of the component —
 * the picker itself formats through react-intl.
 */

import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function ordinal(day: number): string {
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Opens the labelled date picker and chooses `civil` (`YYYY-MM-DD`). */
export async function pickDate(user: UserEvent, label: string, civil: string) {
  await user.click(await screen.findByLabelText(label));
  const year = civil.slice(0, 4);
  const month = Number(civil.slice(5, 7));
  const day = Number(civil.slice(8, 10));
  // Awaited, not read once: the calendar is in a presence layer that
  // mounts a tick after the trigger is pressed.
  const calendar = await screen.findByRole("dialog", { name: "Choose a date" });
  await user.selectOptions(
    within(calendar).getByRole("combobox", { name: "Month" }),
    MONTHS[month - 1]!,
  );
  await user.selectOptions(within(calendar).getByRole("combobox", { name: "Year" }), year);
  await user.click(
    within(calendar).getByRole("button", {
      name: new RegExp(`${MONTHS[month - 1]} ${ordinal(day)}, ${year}`),
    }),
  );
}

/** Opens the labelled date picker and clears it. */
export async function clearDate(user: UserEvent, label: string) {
  await user.click(await screen.findByLabelText(label));
  const calendar = await screen.findByRole("dialog", { name: "Choose a date" });
  await user.click(within(calendar).getByRole("button", { name: "Clear date" }));
}
