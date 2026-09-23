// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-004's reminder lead times, as both panes that edit a list read
 * them: the organization's default on Settings → Reminder lead times,
 * and a person's own list on Settings → Notifications.
 */
import type { IntlShape } from "react-intl";

/** The furthest ahead one lead time may look, as the API bounds it:
 * two years, which covers a long notice window and stops a mistyped
 * number becoming a schedule. */
export const MAX_OFFSET_DAYS = 730;

/** How many lead times one list holds, as the API bounds it. */
export const MAX_OFFSETS = 20;

/** How one lead time reads. Day-of is a phrase rather than "0 days",
 * because nobody says nought days before. */
export const offsetLabel = (intl: IntlShape, days: number): string =>
  intl.formatMessage(
    {
      id: "settings.reminders.offset",
      defaultMessage: "{days, plural, =0 {On the day} one {# day before} other {# days before}}",
    },
    { days },
  );
