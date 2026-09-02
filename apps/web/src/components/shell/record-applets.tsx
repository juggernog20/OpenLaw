// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record-page right side (DES-016, #47): record content, the side
 * panel, then the activity bar on the trailing edge. Mount this inside
 * a record page's main region and pass the applets that page offers.
 *
 * One applet is visible at a time. Clicking an icon expands its applet;
 * clicking the expanded icon collapses the panel. If the page swaps its
 * applet set, an expanded applet that is no longer offered simply stops
 * resolving, so the panel collapses instead of showing a stale tool.
 *
 * No page mounts this yet — the first production mount is the contract
 * record at M8/M9.
 */

import { useEffect, useId, useRef, useState, type ReactNode, type TransitionEvent } from "react";
import { useIntl } from "react-intl";
import { cn } from "../../lib/utils";
import { ActivityBar } from "./activity-bar";
import { AppletPanel } from "./applet-panel";
import type { Applet, PanelApplet } from "./applets";

/** How long a closing panel stays mounted when the clip's own
 * `transitionend` never arrives. Longer than the 200ms slide, short
 * enough that nobody reads the leftover as a panel that failed to
 * close. */
const CLOSING_RETENTION_MS = 400;

export function RecordApplets({
  applets,
  layer,
  contentCovered = false,
  children,
}: Readonly<{
  applets: readonly Applet[];
  /**
   * A wider sibling layer beside the applet panel, or nothing.
   *
   * DES-016 names one: the doc panel (M12/2), which is too wide to be
   * an applet and opens beside the panel rather than inside it. It is
   * passed in rather than rendered by the page's own content, because
   * only this component's flex row can hold a column — a layer drawn
   * inside `children` would sit inside the record's own scroll.
   */
  layer?: ReactNode;
  /**
   * True while the layer covers the record content instead of docking
   * beside it. The content is then behind an opaque surface, so it
   * leaves the tab order and the accessibility tree for as long as that
   * lasts — DES-010's rule that an overlay owns the keyboard. Only the
   * layer knows which case applies (it carries the threshold), so the
   * page relays the answer here.
   */
  contentCovered?: boolean;
  /** The record's own content, beside the panel. */
  children: ReactNode;
}>) {
  const intl = useIntl();
  const generatedPanelId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The clip animates width; the aside has to stay mounted through the
  // close or the slide has nothing to show. `closingShown` is that
  // extra frame. A page that drops the applet is not a close — there
  // is nothing left to slide, so it unmounts immediately.
  const [closingShown, setClosingShown] = useState<PanelApplet | null>(null);
  const triggers = useRef(new Map<string, HTMLElement>());
  const appletsRef = useRef(applets);
  useEffect(() => {
    appletsRef.current = applets;
  });

  // Resolved from the current set, never from the last click: a page
  // that drops an applet drops its panel with it.
  const expanded =
    applets.find(
      (applet): applet is PanelApplet => applet.id === expandedId && applet.href === undefined,
    ) ?? null;
  const shown = expanded ?? closingShown;
  // An applet that names a fragment takes that id as the panel's, so
  // the link that opened it still has a target once the panel is on
  // screen. Everyone else keeps the generated id.
  const panelId = shown?.hash ?? generatedPanelId;

  // A retained closing panel is inert and already logically closed.
  // Report the resolved expanded applet rather than whether its render
  // tree is still mounted for the width transition.
  const expandedChange = expanded?.onExpandedChange;
  useEffect(() => {
    expandedChange?.(true);
    return () => expandedChange?.(false);
  }, [expandedChange]);

  // DES-047: a hash link whose fragment matches an applet opens that
  // applet. Native fragment navigation would miss — the panel is not
  // in the DOM until it is expanded — so this is the whole of the
  // jump. The click listener covers a second press of the same hash,
  // which does not fire `hashchange`.
  useEffect(() => {
    function openFromHash(raw: string) {
      if (raw === "") return;
      const match = appletsRef.current.find(
        (applet): applet is PanelApplet => applet.href === undefined && applet.hash === raw,
      );
      if (match) {
        setClosingShown(null);
        setExpandedId(match.id);
      }
    }

    function onHashChange() {
      openFromHash(window.location.hash.replace(/^#/, ""));
    }

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href^='#']");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href === null) return;
      openFromHash(href.replace(/^#/, ""));
    }

    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
    };
  }, []);

  function toggle(applet: Applet) {
    // Link slots navigate; they never own the panel.
    if (applet.href !== undefined) return;
    // Against the resolved applet, not the remembered id. A page that
    // drops an applet leaves the id behind with no panel on screen, so
    // an id match there would read the first press on the applet's
    // return as "collapse this" and show nothing.
    if (expanded?.id === applet.id) {
      setClosingShown(expanded);
      setExpandedId(null);
      return;
    }
    setClosingShown(null);
    setExpandedId(applet.id);
  }

  // Closing from inside the panel (its X, or Esc) unmounts whatever
  // holds focus, so focus moves back to the applet's bar icon —
  // DES-010's restore-to-trigger rule, done by hand because the panel
  // is a plain aside, not a Radix overlay. The aside stays mounted
  // through the slide; inert, so it is already gone from the tab order.
  function close() {
    if (expanded) triggers.current.get(expanded.id)?.focus();
    setClosingShown(expanded);
    setExpandedId(null);
  }

  // `transitionend` is the normal way the retained panel goes, and it
  // is not a guarantee. A reader who asked for less motion has the
  // width transition stripped, and a clip hidden mid-slide never
  // finishes one either — both leave a closed applet mounted for good.
  // So the retention has a deadline as well as an event: comfortably
  // past the 200ms slide, and cleared the moment either the event wins
  // or the applet opens again.
  useEffect(() => {
    if (expanded || !closingShown) return;
    const timer = setTimeout(() => setClosingShown(null), CLOSING_RETENTION_MS);
    return () => clearTimeout(timer);
  }, [expanded, closingShown]);

  function onClipTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.propertyName !== "width") return;
    if (event.target !== event.currentTarget) return;
    if (expanded) return;
    setClosingShown(null);
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* Content and layer share one region, and the applet panel and
          the activity bar are outside it. That is what lets a layer
          overlay: it covers the record content and nothing else, so an
          applet stays on screen beside a document rather than behind
          it, and opening one narrows the layer instead of being hidden
          by it. It is also the box the docking threshold measures —
          the space a layer can actually dock into. */}
      <div className="@container/record relative flex min-h-0 min-w-0 flex-1">
        <div inert={contentCovered} className="min-h-0 min-w-0 flex-1">
          {children}
        </div>
        {/* Docked, the record reads on the left and the document on the
            right of it, with the applet beyond them both. */}
        {layer}
      </div>
      {/* Always in the row at width 0 when collapsed, so the first open
          has a previous frame to interpolate from. Inner column is a
          fixed 320px packed to the trailing edge — the clip growing is
          what reads as the drawer sliding out of the activity bar. */}
      <div
        className={cn(
          "flex min-h-0 shrink-0 justify-end overflow-hidden transition-[width] duration-200 ease-out",
          expanded ? "w-(--width-panel)" : "w-0",
        )}
        onTransitionEnd={onClipTransitionEnd}
      >
        {shown ? (
          <AppletPanel
            key={shown.id}
            id={panelId}
            label={intl.formatMessage(shown.label)}
            accessory={shown.accessory?.()}
            inert={!expanded}
            onClose={close}
          >
            {shown.render()}
          </AppletPanel>
        ) : null}
      </div>
      <ActivityBar
        applets={applets}
        activeId={expanded?.id ?? null}
        panelId={panelId}
        onToggle={toggle}
        triggerRef={(id, node) => {
          if (node) triggers.current.set(id, node);
          else triggers.current.delete(id);
        }}
      />
    </div>
  );
}
