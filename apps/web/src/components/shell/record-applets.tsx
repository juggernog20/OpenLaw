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

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { ActivityBar } from "./activity-bar";
import { AppletPanel } from "./applet-panel";
import type { Applet, PanelApplet } from "./applets";

export function RecordApplets({
  applets,
  layer,
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
  /** The record's own content, beside the panel. */
  children: ReactNode;
}>) {
  const intl = useIntl();
  const generatedPanelId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  // An applet that names a fragment takes that id as the panel's, so
  // the link that opened it still has a target once the panel is on
  // screen. Everyone else keeps the generated id.
  const panelId = expanded?.hash ?? generatedPanelId;

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
      if (match) setExpandedId(match.id);
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
    setExpandedId((current) => (current === applet.id ? null : applet.id));
  }

  // Closing from inside the panel (its X, or Esc) unmounts whatever
  // holds focus, so focus moves back to the applet's bar icon —
  // DES-010's restore-to-trigger rule, done by hand because the panel
  // is a plain aside, not a Radix overlay.
  function close() {
    if (expanded) triggers.current.get(expanded.id)?.focus();
    setExpandedId(null);
  }

  return (
    <div className="@container/record relative flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">{children}</div>
      {/* Between the content and the applet panel: docked, the record
          reads on the left, the document in the middle, and the applet
          on the right. */}
      {layer}
      {expanded ? (
        <AppletPanel
          key={expanded.id}
          id={panelId}
          label={intl.formatMessage(expanded.label)}
          accessory={expanded.accessory?.()}
          onClose={close}
        >
          {expanded.render()}
        </AppletPanel>
      ) : null}
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
