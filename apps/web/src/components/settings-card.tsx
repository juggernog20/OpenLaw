// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The card chrome every settings pane shares (ST1/ST4 mocks): a Card
 * with the section-header strip on top. One definition, so the header
 * height and pane width stay identical across panes — both dimensions
 * come from the chrome-dimension tokens in globals.css.
 *
 * A card can be a disclosure (DES-054). Opt in with `collapsible`, and
 * the header's title becomes the button that opens and closes the body,
 * on the settings rail's own disclosure anatomy: a 16px chevron before
 * the name, `aria-expanded` and `aria-controls`, and a body that is
 * conditionally rendered rather than hidden with CSS.
 */

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { Card } from "./ui/card";

export function SettingsCard({
  title,
  actions,
  collapsible = false,
  defaultOpen = true,
  flush = false,
  className,
  children,
}: Readonly<{
  title: ReactNode;
  /** Right-aligned header controls (filters, a primary action). */
  actions?: ReactNode;
  /** Turns the header into a disclosure for the body (DES-054). */
  collapsible?: boolean;
  /** Which way a collapsible card starts. Ignored without `collapsible`. */
  defaultOpen?: boolean;
  /** Edge-to-edge body for content that owns its gutters (tables). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = !collapsible || open;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Card className={cn("w-full max-w-(--width-settings-card)", className)}>
      <div
        className={cn(
          "flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4",
          actions && "justify-between",
          // A closed card is its header, so the strip carries the
          // card's own bottom edge: the rule would otherwise sit above
          // the border with nothing between them.
          !shown && "rounded-b-card border-b-0",
        )}
      >
        {collapsible ? (
          // The button takes the strip's free width so the target is
          // the header, not just the words. The negative inset keeps
          // the title on the card's own gutter while the focus ring
          // still clears it.
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
            className="-mx-1.5 flex flex-1 items-center gap-2 rounded-button px-1.5 py-1 text-start focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
          >
            <Chevron size={16} aria-hidden="true" className="text-muted" />
            <h2 className="text-base font-semibold">{title}</h2>
          </button>
        ) : (
          <h2 className="text-base font-semibold">{title}</h2>
        )}
        {actions}
      </div>
      {/* `contents` keeps the wrapper out of the card's layout, so a
          plain card lays out exactly as it did before the disclosure
          existed and a flush body still reaches both edges. */}
      <div id={bodyId} className="contents">
        {shown && (flush ? children : <div className="flex flex-col gap-4 p-4">{children}</div>)}
      </div>
    </Card>
  );
}
