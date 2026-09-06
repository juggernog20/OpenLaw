// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { FormattedMessage } from "react-intl";
import type { DatesHomeSection } from "../../lib/home";
import { HomeSectionCard } from "./section-card";
import { HomeDateLink } from "./date-row";
import { DatesCalendarDialog } from "./dates-calendar-dialog";
import { Dialog, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";

export function HomeDatesCard({ section }: Readonly<{ section: DatesHomeSection }>) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <HomeSectionCard
        headingId="home-dates-heading"
        title={<FormattedMessage id="home.dates.title" defaultMessage="Dates approaching" />}
        total={section.total}
        headerAction={
          <DialogTrigger asChild>
            <Button variant="link" size="sm">
              <FormattedMessage
                id="home.section.viewAll"
                defaultMessage="View all {count}"
                values={{ count: section.total }}
              />
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </DialogTrigger>
        }
      >
        {section.rows.map((row) => (
          <li
            key={`${row.record.kind}:${row.record.id}:${row.source}:${row.keyDateId ?? "derived"}`}
          >
            <HomeDateLink row={row} />
          </li>
        ))}
      </HomeSectionCard>
      {open ? <DatesCalendarDialog /> : null}
    </Dialog>
  );
}
