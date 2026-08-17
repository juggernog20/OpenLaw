// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A civil-date field (DES-048): the C10 control that opens a month
 * calendar rather than the browser's `type="date"` chrome. The value
 * it holds and writes is a bare `YYYY-MM-DD`; the label it shows is
 * `formatFullDate`. Picking a day is the commit — there is no draft
 * to blur. Escape on the closed trigger reverts, the same key the
 * typed fields use. Collision places the popover above or below the
 * field so the calendar stays in view; the month grid does not
 * resize, so previous and next stay put while paging.
 */

import { useId, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Calendar as CalendarIcon } from "lucide-react";
import { formatFullDate } from "../lib/format";
import { CONTROL_CLASS } from "../lib/form-controls";
import { cn } from "../lib/utils";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** Local midnight for a stored civil date, so the picker day matches
 * the calendar date in every timezone. */
export function civilToLocalDate(civil: string): Date | undefined {
  if (!CIVIL.test(civil)) return undefined;
  const year = Number(civil.slice(0, 4));
  const month = Number(civil.slice(5, 7));
  const day = Number(civil.slice(8, 10));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

export function localDateToCivil(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const START_MONTH = new Date(1970, 0);
function endMonth(): Date {
  return new Date(new Date().getFullYear() + 50, 11);
}

export function DatePicker({
  id,
  value,
  disabled,
  onChange,
  onRevert,
}: Readonly<{
  id?: string;
  /** A bare `YYYY-MM-DD`, or empty when nothing is recorded. */
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  /** Escape on the closed trigger — a refused pick still showing. */
  onRevert?: () => void;
}>) {
  const intl = useIntl();
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => civilToLocalDate(value), [value]);
  const calendarLabel = intl.formatMessage({
    id: "datePicker.calendar",
    defaultMessage: "Choose a date",
  });

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={triggerId}
          disabled={disabled}
          className={cn(CONTROL_CLASS, "inline-flex items-center justify-start gap-2 text-start", {
            "text-muted": value === "",
          })}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || open) return;
            event.preventDefault();
            onRevert?.();
          }}
        >
          <CalendarIcon size={16} aria-hidden="true" />
          {value === "" ? (
            <FormattedMessage id="datePicker.placeholder" defaultMessage="Select a date" />
          ) : (
            formatFullDate(value)
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto"
        side="bottom"
        collisionPadding={8}
        aria-label={calendarLabel}
      >
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={selected}
          defaultMonth={selected ?? new Date()}
          startMonth={START_MONTH}
          endMonth={endMonth()}
          labels={{
            labelMonthDropdown: () =>
              intl.formatMessage({ id: "datePicker.month", defaultMessage: "Month" }),
            labelYearDropdown: () =>
              intl.formatMessage({ id: "datePicker.year", defaultMessage: "Year" }),
            labelPrevious: () =>
              intl.formatMessage({
                id: "datePicker.previousMonth",
                defaultMessage: "Previous month",
              }),
            labelNext: () =>
              intl.formatMessage({ id: "datePicker.nextMonth", defaultMessage: "Next month" }),
          }}
          onSelect={(date) => {
            if (!date) return;
            onChange(localDateToCivil(date));
            setOpen(false);
          }}
        />
        {value !== "" && (
          <button
            type="button"
            className="mt-2 text-sm font-medium text-link focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
            aria-label={intl.formatMessage({
              id: "datePicker.clear",
              defaultMessage: "Clear date",
            })}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <FormattedMessage id="action.clear" defaultMessage="Clear" />
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
