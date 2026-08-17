// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Calendar (DES-004: shadcn Calendar over react-day-picker, owned
 * source). Layout comes from DayPicker's stylesheet; color, radius,
 * and type follow our tokens. Lucide replaces DayPicker's own chevron
 * polygons (DES-008). Month animation is off — DES-003.
 *
 * Width is the seven day columns, not the month caption: previous and
 * next sit on that edge so a longer name ("September") cannot shove
 * them. The grid is always six weeks so paging months cannot resize
 * the box either (DES-048).
 */

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";
import { cn } from "../../lib/utils";

import "react-day-picker/style.css";

const CHEVRONS = {
  left: ChevronLeft,
  right: ChevronRight,
  up: ChevronUp,
  down: ChevronDown,
} as const;

function CalendarChevron({
  orientation = "left",
  className,
}: Readonly<{
  orientation?: keyof typeof CHEVRONS;
  className?: string;
}>) {
  const Icon = CHEVRONS[orientation];
  return <Icon size={16} className={cn("text-primary", className)} aria-hidden="true" />;
}

export function Calendar({ className, classNames, components, ...props }: DayPickerProps) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      navLayout="around"
      showOutsideDays
      fixedWeeks
      animate={false}
      {...props}
      className={cn(
        "overflow-x-hidden p-1 text-sm text-primary [--rdp-accent-color:var(--cta-primary)] [--rdp-day-height:2.25rem] [--rdp-day-width:2.25rem] [--rdp-day_button-border-radius:var(--radius-button)] [--rdp-day_button-height:2.25rem] [--rdp-day_button-width:2.25rem] [--rdp-nav-height:2rem] [--rdp-nav_button-height:1.5rem] [--rdp-nav_button-width:1.5rem] [--rdp-selected-border:2px_solid_transparent] [--rdp-today-color:var(--text-link)]",
        className,
      )}
      classNames={{
        months: cn(defaults.months, "max-w-[calc(7*var(--rdp-day-width))]"),
        month: cn(defaults.month, "w-[calc(7*var(--rdp-day-width))]"),
        month_caption: cn(defaults.month_caption, "w-full min-w-0 text-sm font-medium!"),
        dropdowns: cn(defaults.dropdowns, "max-w-full min-w-0"),
        weekday: cn(defaults.weekday, "text-xs font-medium text-muted"),
        selected: cn(
          defaults.selected,
          "font-medium! text-sm! [&_.rdp-day_button]:border-transparent [&_.rdp-day_button]:bg-cta-primary [&_.rdp-day_button]:text-on-cta",
        ),
        day_button: cn(
          defaults.day_button,
          "text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link",
        ),
        button_previous: cn(
          defaults.button_previous,
          "rounded-button text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link",
        ),
        button_next: cn(
          defaults.button_next,
          "rounded-button text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link",
        ),
        dropdown_root: cn(
          defaults.dropdown_root,
          "min-w-0 rounded-button border border-border-default bg-raised px-1.5 text-sm",
        ),
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron, ...components }}
    />
  );
}
