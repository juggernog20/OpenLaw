// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mobile nav drawer (DES-012, #46): below the md breakpoint the top
 * nav collapses into this hamburger-triggered drawer. Same destination
 * registry, same chrome surface as the nav it replaces — only the axis
 * changes. Radix supplies the dialog role, focus trap, Esc and
 * overlay dismissal, and focus restoration to the hamburger.
 */

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu } from "lucide-react";
import { NavLink } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { cn } from "../../lib/utils";
import { destinationsFor } from "./destinations";

export function NavDrawer({ role }: Readonly<{ role: string }>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const destinations = destinationsFor(role);

  // DES-012's one cliff, mirrored from CSS: crossing up into md while
  // the drawer is open (tablet rotation, window resize) closes it —
  // otherwise its focus trap and scroll lock would linger over the
  // desktop chrome, where the trigger itself is display:none.
  useEffect(() => {
    const md = window.matchMedia("(min-width: 768px)");
    function onChange(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }
    md.addEventListener("change", onChange);
    return () => md.removeEventListener("change", onChange);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label={intl.formatMessage({ id: "shell.nav.open", defaultMessage: "Open navigation" })}
        className="flex size-8 items-center justify-center rounded-button text-on-inverted hover:bg-(--chrome-search-bg) md:hidden"
      >
        <Menu size={20} aria-hidden="true" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[80vw] flex-col border-e border-(--chrome-nav-border) bg-(--chrome-nav-bg) py-3"
        >
          <DialogPrimitive.Title className="sr-only">
            <FormattedMessage id="shell.nav.title" defaultMessage="Navigation" />
          </DialogPrimitive.Title>
          <nav
            aria-label={intl.formatMessage({ id: "shell.nav.primary", defaultMessage: "Primary" })}
            className="flex flex-col"
          >
            {destinations.map((destination) => (
              <NavLink
                key={destination.id}
                to={destination.path}
                end={destination.path === "/"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex h-10 items-center gap-2 border-s-2 pe-4 ps-3 text-md",
                    isActive
                      ? "border-accent font-semibold text-on-inverted"
                      : "border-transparent font-medium text-(--chrome-nav-muted) hover:text-on-inverted",
                  )
                }
              >
                <destination.icon size={16} aria-hidden="true" />
                <FormattedMessage {...destination.label} />
              </NavLink>
            ))}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
