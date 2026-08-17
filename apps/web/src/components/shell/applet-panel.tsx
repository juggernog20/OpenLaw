// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record-page side panel (DES-016, #47), from the panel frames of
 * designs/matters.pen (M3 comments, M13 history): a 320px surface
 * hosting whichever applet the activity bar has expanded, one at a
 * time, under a 44px header carrying the applet's title and a close
 * control. The M3 header also shows a count pill — that is applet
 * content (total comments, not the bar badge's unread count) and lands
 * with the chat applet, not here. Focus lands on the panel container
 * when it opens, not on Close; Esc from inside then closes it
 * (DES-010's overlay rule — Radix does not drive this aside).
 *
 * Docking is a container query on the record region, per DES-012. At or
 * above ~1100px of region width the panel is a flex sibling holding its
 * own 320px column; below that it overlays the content, pinned to the
 * inner edge of the activity bar, which never disappears. The threshold
 * is written into the class list literally: Tailwind scans source text,
 * so a variable would leave the utility ungenerated.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useIntl } from "react-intl";

export function AppletPanel({
  id,
  label,
  accessory,
  onClose,
  children,
}: Readonly<{
  id: string;
  /** Accessible name and header title — the active applet's label. */
  label: string;
  /** The active applet's own header content, beside the title. */
  accessory?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}>) {
  const intl = useIntl();
  const panel = useRef<HTMLElement>(null);

  // Focus moves into the panel when it opens, so the next Tab is inside
  // it and a screen reader reads what just appeared (DES-010). The
  // container takes it rather than the close button: landing on Close
  // reads as "you probably want to leave". Same treatment as DocPanel.
  useEffect(() => {
    panel.current?.focus();
  }, [id, label]);

  return (
    <aside // NOSONAR — the listener serves DES-010's Esc rule, not interactivity
      ref={panel}
      id={id}
      tabIndex={-1}
      aria-label={label}
      // DES-010 says Esc closes the topmost overlay. The panel is a
      // plain aside, so Radix does not handle the key for it; a layer
      // inside an applet that already consumed the press marks it
      // defaultPrevented.
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
      className="absolute inset-y-0 end-(--width-activitybar) z-10 flex w-(--width-panel) shrink-0 flex-col border-s border-border-default bg-raised outline-none @min-[1100px]/record:static @min-[1100px]/record:z-auto"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-muted px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold">{label}</h2>
          {accessory}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={intl.formatMessage({ id: "applets.closePanel", defaultMessage: "Close" })}
          className="-me-1 flex size-6 items-center justify-center text-muted hover:text-primary"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
