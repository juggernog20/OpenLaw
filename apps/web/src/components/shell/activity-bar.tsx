// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Record-page activity bar (DES-016, #47), from the ActivityBar frames
 * of the matter-detail screens in designs/matters.pen (M2/M3/M13) —
 * the newest mock suite and the one that draws the decided applet set:
 * a 48px strip on the record's trailing edge with 12px vertical
 * padding, 32px icon slots on an 8px gap, and a 24px divider ahead of
 * the below-divider group. Everything sits on body surface tokens — the
 * frames' fills are exactly raised / border-default / border-muted /
 * text-muted in Light values — not the DES-019 chrome group, which
 * exists for the top slab that restructures per theme.
 *
 * Normalizations against the frames, recorded under DES-016: glyphs
 * render at the 20px Lucide scale where the frames draw 18px (DES-008,
 * the DES-019 brand-glyph precedent); the badge count uses the 11px
 * `text-xs` step where the frames draw 9px (DES-006); and the active
 * applet keeps DES-016's accent indicator strip with a text-primary
 * glyph — the frames tint the active glyph with the avatar blue
 * instead, which is 2.4:1 on white, under DES-011's 3:1 floor.
 */

import * as Toolbar from "@radix-ui/react-toolbar";
import { defineMessage, useIntl } from "react-intl";
import { cn } from "../../lib/utils";
import type { Applet } from "./applets";

const BAR_LABEL = defineMessage({ id: "applets.barLabel", defaultMessage: "Applets" });

/** Folds the badge count into the icon's accessible name — the badge
 * itself is decorative, so the count would otherwise go unannounced. */
const LABEL_WITH_BADGE = defineMessage({
  id: "applets.labelWithBadge",
  defaultMessage: "{label} ({count})",
});

export function ActivityBar({
  applets,
  activeId,
  panelId,
  onToggle,
  triggerRef,
}: Readonly<{
  applets: readonly Applet[];
  /** The expanded applet, or null when the panel is collapsed. */
  activeId: string | null;
  /** The panel element the icons control; only referenced while open. */
  panelId: string;
  onToggle: (applet: Applet) => void;
  /** Receives each panel slot's control (null on unmount) — the panel
   * owner focuses these to restore focus when the panel closes
   * (DES-010; the panel is not a Radix overlay, so nothing restores
   * focus for it). */
  triggerRef?: (id: string, node: HTMLElement | null) => void;
}>) {
  const intl = useIntl();
  const belowDivider = applets.filter((applet) => applet.group === "below-divider");
  const leading = applets.filter((applet) => applet.group !== "below-divider");

  function slot(applet: Applet) {
    const active = applet.id === activeId;
    const name =
      applet.badge && applet.badge > 0
        ? intl.formatMessage(LABEL_WITH_BADGE, {
            label: intl.formatMessage(applet.label),
            count: intl.formatNumber(applet.badge),
          })
        : intl.formatMessage(applet.label);

    const face = (
      <>
        {/* The strip marks the slot on the bar's leading edge, so the
            control spans the bar's full width, not just the 32px slot. */}
        {active ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 start-0 w-activitybar-indicator bg-accent"
          />
        ) : null}
        <applet.icon size={20} aria-hidden="true" />
        {/* Overhangs the glyph's trailing top corner, as in the frames. */}
        {applet.badge && applet.badge > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 end-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-badge-alert-bg px-1 text-xs font-semibold text-badge-alert-fg"
          >
            {intl.formatNumber(applet.badge)}
          </span>
        ) : null}
      </>
    );
    const faceClass = cn(
      "relative flex h-8 w-full items-center justify-center",
      active ? "text-primary" : "text-muted hover:text-primary",
    );

    return applet.href === undefined ? (
      <Toolbar.Button
        key={applet.id}
        ref={(node) => triggerRef?.(applet.id, node)}
        type="button"
        aria-label={name}
        aria-expanded={active}
        aria-controls={active ? panelId : undefined}
        onClick={() => onToggle(applet)}
        className={faceClass}
      >
        {face}
      </Toolbar.Button>
    ) : (
      <Toolbar.Link key={applet.id} href={applet.href} aria-label={name} className={faceClass}>
        {face}
      </Toolbar.Link>
    );
  }

  return (
    <Toolbar.Root
      orientation="vertical"
      aria-label={intl.formatMessage(BAR_LABEL)}
      className="flex w-(--width-activitybar) shrink-0 flex-col items-center gap-2 border-s border-default bg-raised py-3"
    >
      {leading.map(slot)}
      {belowDivider.length > 0 ? (
        <>
          {/* The group flows right after the leading slots, per the
              matters.pen frames — no mt-auto: pinning it to the bar's
              bottom edge was the superseded V12/V13 treatment. A rule
              separates two groups, so a page offering only the
              below-divider group (the M8 contract record, before the
              chat and history applets exist) draws no rule. */}
          {leading.length > 0 ? (
            <Toolbar.Separator className="h-px w-6 shrink-0 bg-border-muted" />
          ) : null}
          {belowDivider.map(slot)}
        </>
      ) : null}
    </Toolbar.Root>
  );
}
