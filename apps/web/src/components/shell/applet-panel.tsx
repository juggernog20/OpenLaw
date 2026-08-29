// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record-page side panel (DES-016, #47), from the panel frames of
 * designs/matters.pen (M3 comments, M13 history): a 320px surface
 * hosting whichever applet the activity bar has expanded, one at a
 * time, under a 44px header carrying the applet's title and a close
 * control. The M3 header also shows a count pill. That pill is applet
 * content (total comments, not the bar badge's unread count) and lands
 * with the chat applet, not here. Focus lands on the panel container
 * when it opens, not on Close. Esc from inside then closes it, which
 * is DES-010's overlay rule. Radix does not drive this aside.
 *
 * Always a flex sibling: opening it takes a 320px column and the
 * record content shrinks. Overlaying (DES-012's below-threshold rule)
 * is superseded for this panel. See the DES-016 2026-08-17
 * clarification. The doc panel is the other case and keeps a threshold
 * of its own, so do not read this as a rule about layers in general.
 * This column is outside the box that panel can cover, which is why
 * the two are open together at any width. The clip that slides the
 * column lives on RecordApplets; this aside is the inner 320px, packed
 * to the trailing edge so the growing clip reads as a drawer coming
 * out of the activity bar.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useIntl } from "react-intl";

export function AppletPanel({
  id,
  label,
  accessory,
  inert = false,
  onClose,
  children,
}: Readonly<{
  id: string;
  /** Accessible name and header title: the active applet's label. */
  label: string;
  /** The active applet's own header content, beside the title. */
  accessory?: ReactNode;
  /**
   * True while the clip is sliding shut. Focus has already gone back
   * to the bar, so the aside must not stay in the tab order or the
   * a11y tree for those 200ms.
   */
  inert?: boolean;
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
    if (inert) return;
    panel.current?.focus();
  }, [id, label, inert]);

  return (
    <aside // NOSONAR: the listener serves DES-010's Esc rule, not interactivity
      ref={panel}
      id={id}
      tabIndex={-1}
      aria-label={label}
      // DES-010 says Esc closes the topmost overlay. The panel is a
      // plain aside, so Radix does not handle the key for it. A layer
      // inside an applet that already consumed the press marks it
      // defaultPrevented, and the panel stays open.
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
      inert={inert}
      className="flex h-full w-(--width-panel) shrink-0 flex-col border-s border-border-default bg-raised outline-none"
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
