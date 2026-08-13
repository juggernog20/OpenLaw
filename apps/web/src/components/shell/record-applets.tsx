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

import { useId, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { ActivityBar } from "./activity-bar";
import { AppletPanel } from "./applet-panel";
import type { Applet, PanelApplet } from "./applets";

export function RecordApplets({
  applets,
  children,
}: Readonly<{
  applets: readonly Applet[];
  /** The record's own content, beside the panel. */
  children: ReactNode;
}>) {
  const intl = useIntl();
  const panelId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLElement>());

  // Resolved from the current set, never from the last click: a page
  // that drops an applet drops its panel with it.
  const expanded =
    applets.find(
      (applet): applet is PanelApplet => applet.id === expandedId && applet.href === undefined,
    ) ?? null;

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
      {expanded ? (
        <AppletPanel
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
