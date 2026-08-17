// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Applet declarations for the record-page activity bar (DES-016, #47).
 *
 * An applet is one page-scoped tool reachable from the activity bar.
 * Unlike the top-nav destination registry, there is no global applet
 * list: each record page passes the set it offers, so the bar can never
 * show a tool that page does not have. Contract details opens with
 * team (DES-047), chat (CMT-004), history (DD-017), and the settings
 * deep-link (SET-001) grouped below the divider.
 *
 * A slot either opens the side panel (`render`) or navigates away
 * (`href`) — the settings slot is a deep link, not a panel.
 */

import type { LucideIcon } from "lucide-react";
import type { MessageDescriptor } from "react-intl";
import type { ReactNode } from "react";

interface AppletBase {
  /** Stable across renders; identifies the expanded applet. */
  id: string;
  icon: LucideIcon;
  /** Accessible name of the icon and of the panel it opens. */
  label: MessageDescriptor;
  /**
   * Count shown in the icon's badge slot, and folded into the icon's
   * accessible name. Omit or pass 0 for no badge. Per CMT-004 chat is
   * the only applet that carries one.
   */
  badge?: number;
  /** Places the slot in the group below the bar's divider. The group
   * flows right after the leading slots — it is not pinned to the
   * bar's bottom edge (that was the superseded V12/V13 treatment; see
   * the DES-016 implementation clarification). */
  group?: "below-divider";
}

/** A slot that expands the side panel with its own content. */
export interface PanelApplet extends AppletBase {
  render: () => ReactNode;
  /**
   * Rendered beside the panel's title while the applet is open. The
   * panel header is chrome, but what sits in it is the applet's — the
   * M3 count pill is the first user (DES-016's implementation
   * clarification, point 5). Omit for a plain title.
   */
  accessory?: () => ReactNode;
  /**
   * Fragment id (without `#`) that opens this applet. DES-028's
   * "Manage team" link is the first user: clicking `#contract-team`
   * expands the team panel rather than scrolling to a card that is
   * no longer in the page body (DES-047).
   */
  hash?: string;
  href?: never;
}

/** A slot that leaves the page instead of opening the panel. */
export interface LinkApplet extends AppletBase {
  href: string;
  render?: never;
}

export type Applet = PanelApplet | LinkApplet;
