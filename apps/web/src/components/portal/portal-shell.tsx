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
 * full application the way they always did, so the portal owes them no
 * door back.
 *
 * The trailing cluster carries the two things a requester's session
 * owns (M20/9). The bell is NOT-001's second surface, the same
 * anatomy DES-049 settled for the staff centre, backed by the portal's
 * own four routes; the gear beside it is the lightweight settings
 * surface NOT-001 promised, which is the group-5 toggles and nothing
 * else. They are the only two portal destinations there are, which is
 * why they are two glyphs rather than a nav.
 *
 * The shell owns the scroll and gives it to `main` alone, as the staff
 * shell does (DES-030): the header keeps its height through a long
 * request thread rather than being pushed off the top of it.
 */

import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { applyPreferredTheme, type Theme } from "../../lib/theme";
import { retainLiveEvents, type LiveEventRecordScope } from "../../lib/events";
import { Avatar } from "../avatar";
import { NotificationBell } from "../notification-bell";
import { SkipLink } from "../skip-link";
import { Button } from "../ui/button";

/** Who the portal header draws. Narrower than the staff shell's user on
 * purpose: the portal branches on nothing about the role. */
export interface PortalUser {
  displayName: string;
  email: string;
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
  // The server value wins over the pre-paint mirror, the same way the
  // staff shell reconciles it (#44). A magic-link session is often a
  // first visit on this browser, where there is no mirror to reconcile.
  useLayoutEffect(() => {
    applyPreferredTheme(user.theme);
  }, [user.theme]);

  // The portal is the second authenticated shell over the same tab-wide
  // channel. Consumers subscribe to the module and never open a stream.
  const liveEntityType = recordScope?.entityType;
  const liveEntityId = recordScope?.entityId;
  useEffect(
    () =>
      retainLiveEvents(
        liveEntityType && liveEntityId
          ? { entityType: liveEntityType, entityId: liveEntityId }
          : undefined,
      ),
    [liveEntityType, liveEntityId],
  );

  return (
    <div className="@container/shell flex h-dvh flex-col overflow-hidden bg-canvas text-primary">
      <SkipLink />
      <header className="flex h-(--height-header) shrink-0 items-center justify-between gap-4 border-b border-border-default bg-raised px-page-x">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-md font-semibold">
            <FormattedMessage id="portal.brand" defaultMessage="OpenLaw" />
          </span>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border-default" />
          <span className="truncate text-base text-muted">
            <FormattedMessage id="portal.name" defaultMessage="Legal request portal" />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
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
          <Avatar name={user.displayName} image={user.image} className="size-6" />
          {/* The address yields its width first: below md the identity
              is the avatar and the way out (DES-012). */}
          <span className="hidden text-sm text-muted md:inline">{user.email}</span>
          <Button variant="link" size="sm" className="px-0 text-sm text-muted" onClick={onSignOut}>
            <FormattedMessage id="auth.signOut" defaultMessage="Sign out" />
          </Button>
        </div>
      </header>
      {/* tabIndex={-1} makes the skip-link target programmatically
          focusable; min-h-0 is what lets the region shrink so the scroll
          stays here instead of returning to the document. */}
      <main
        id="main"
        tabIndex={-1}
        className="@container/page min-h-0 flex-1 overflow-y-auto px-page-x pt-8 pb-12"
      >
        <div className="mx-auto flex w-full max-w-(--width-portal-col) flex-col gap-section-gap">
          {children}
        </div>
      </main>
    </div>
  );
}
