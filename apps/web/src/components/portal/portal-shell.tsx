// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal's chrome (INT-001), from the header and body frames the
 * I5–I7 mocks share: one 62px strip carrying the product mark, the name
 * of the surface, and the signed-in identity with sign-out, over a
 * centered column.
 *
 * What is absent is still the point. There is no top nav, no search, and
 * no activity bar: a Business User sees only their own Requests
 * (DD-013), so every staff destination would open on nothing. Member+
 * staff are welcome here, they submit Requests too, and they reach the
 * full application through the return control shown to Member+ staff.
 *
 * The trailing cluster carries the two things a requester's session
 * owns (M20/9). The bell is NOT-001's second surface, the same
 * anatomy DES-049 settled for the staff centre, backed by the portal's
 * own four routes; the gear beside it is the lightweight settings
 * surface NOT-001 promised, which is the group-5 toggles and nothing
 * else. Product Help joins these controls under DES-073 and remains
 * separate from organization Knowledge.
 *
 * The shell owns the scroll and gives it to `main` alone, as the staff
 * shell does (DES-030): the header keeps its height through a long
 * request thread rather than being pushed off the top of it.
 */

import { HelpLink } from "../documentation/help-link";
import { type ReactNode } from "react";
import { Scale, Settings } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { type Theme } from "../../lib/theme";
import { isMemberPlus, type Role } from "../../lib/roles";
import { useRetainedLiveEvents, type LiveEventRecordScope } from "../../lib/events";
import { Avatar } from "../avatar";
import { PortalThemeMenu } from "./portal-theme-menu";
import { NotificationBell } from "../notification-bell";
import { SkipLink } from "../skip-link";
import { Button } from "../ui/button";

/** The signed-in identity and the role used for the staff return control. */
export interface PortalUser {
  displayName: string;
  email: string;
  role: Role;
  /** Avatar photo (DES-018); absent or null renders initials. */
  image?: string | null;
  theme: Theme;
}

export function PortalShell({
  user,
  onSignOut,
  recordScope,
  children,
}: Readonly<{
  user: PortalUser;
  onSignOut: () => void;
  recordScope?: LiveEventRecordScope;
  children: ReactNode;
}>) {
  const intl = useIntl();
  // The portal is the second authenticated shell over the same tab-wide
  // channel. Consumers subscribe to the module and never open a stream.
  useRetainedLiveEvents(recordScope);

  return (
    <div className="@container/shell flex h-dvh flex-col overflow-hidden bg-canvas text-primary">
      <SkipLink />
      <header className="flex h-(--height-header) shrink-0 items-center justify-between gap-2 border-b border-border-default bg-raised px-4 sm:gap-4 sm:px-page-x">
        <Link
          to="/portal"
          aria-label={intl.formatMessage({
            id: "portal.name",
            defaultMessage: "Legal request portal",
          })}
          className="flex min-w-0 items-center gap-3 rounded-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {/* The staff header's mark (DES-008's scale glyph), on the
              portal's own light strip: the same product, a different
              door. */}
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-card bg-inverted text-on-inverted"
          >
            <Scale size={20} />
          </span>
          <span className="hidden min-w-0 flex-col sm:flex">
            <span className="truncate text-base leading-tight font-semibold text-primary">
              <FormattedMessage id="portal.brand" defaultMessage="OpenLaw" />
            </span>
            <span className="truncate text-sm leading-tight text-muted">
              <FormattedMessage id="portal.name" defaultMessage="Legal request portal" />
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <HelpLink surface="portal" audience="business_user" />
          <PortalThemeMenu initialTheme={user.theme} />
          <NotificationBell surface="portal" />
          {/* The same 24×24 target the bell takes (DES-011), so the two
              glyphs sit on one line without either being the odd one. */}
          <Link
            to="/portal/settings"
            aria-label={intl.formatMessage({
              id: "portal.settings.link",
              defaultMessage: "Notification settings",
            })}
            className="flex size-6 items-center justify-center rounded-button text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            <Settings size={20} aria-hidden="true" />
          </Link>
          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border-default" />
          <Avatar name={user.displayName} image={user.image} className="size-6" />
          {/* The name and address yield their width first: below md the
              identity is the avatar and the way out (DES-012). */}
          <span className="hidden min-w-0 flex-col md:flex">
            <span className="truncate text-sm leading-tight font-medium">{user.displayName}</span>
            <span className="truncate text-xs leading-tight text-muted">{user.email}</span>
          </span>
          <Button variant="ghost" size="sm" className="ms-1 text-muted" onClick={onSignOut}>
            <FormattedMessage id="auth.signOut" defaultMessage="Sign out" />
          </Button>
        </div>
      </header>
      {isMemberPlus(user.role) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-default bg-raised px-page-x py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-base font-semibold">
              <FormattedMessage
                id="portal.businessView.active"
                defaultMessage="Viewing as business user"
              />
            </p>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="portal.businessView.description"
                defaultMessage="You’re viewing your own requests. Submissions and replies are real."
              />
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/settings/profile">
              <FormattedMessage
                id="portal.businessView.return"
                defaultMessage="Return to legal view"
              />
            </Link>
          </Button>
        </div>
      )}
      {/* tabIndex={-1} makes the skip-link target programmatically
          focusable; min-h-0 is what lets the region shrink so the scroll
          stays here instead of returning to the document. */}
      <main
        id="main"
        tabIndex={-1}
        className="@container/page min-h-0 flex-1 overflow-y-auto px-page-x pt-8 pb-16"
      >
        <div className="mx-auto flex w-full max-w-(--width-portal-col) flex-col gap-section-gap">
          {children}
        </div>
      </main>
    </div>
  );
}
