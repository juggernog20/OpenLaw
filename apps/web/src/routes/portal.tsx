// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal home (INT-001), from the I5 frame of intake.pen: where a
 * redeemed magic link lands, and the front door to intake.
 *
 * The loader gates on a session and nothing else. A Business User is
 * routed here from the staff application (see `homeLoader`), and Member+
 * staff are admitted rather than turned away — staff ask legal questions
 * too, and on this surface they are a Requester like anybody else.
 *
 * The body is the request type picker, the "Before you submit…" panel,
 * and the my-requests list, in the order I5 stacks them.
 *
 * **The picker draws the Administrator's live types in their order.**
 * Both reads come from the portal's own requester-facing routes, not
 * from the Administrator-facing Intake Settings ones — those stay shut
 * to a Business User, which is why the portal mount exists.
 *
 * **The picker is the only thing the empty state replaces.** An
 * instance whose Administrator has archived every request type says so
 * where the cards would be; the heading above it and the deflection
 * panel below it are unaffected, because a deflection link is still
 * worth following when there is no form to fill in.
 *
 * ### Recorded normalization points (I5 deviations accepted)
 *
 * 1. I5 draws a per-type lucide glyph beside each name (`file-pen`,
 *    `shield`, `package`, …). A request type carries a slug, a name, a
 *    description, an order, and a target (INT-002) — no icon — so the
 *    card head is the name alone rather than one glyph repeated down
 *    the grid.
 * 2. I5 lays the cards out as two hand-built rows of three. They render
 *    as one auto-filling grid, per DES-012's preference for intrinsic
 *    layout over fixed rows: an Administrator may configure any number
 *    of types, and the mock's six is not the count.
 */

import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { currentUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { DeflectionPanel } from "../components/portal/deflection-panel";
import { MyRequests, REQUEST_TYPE_PICKER_ID } from "../components/portal/my-requests";
import { PortalShell } from "../components/portal/portal-shell";
import { Card, CardContent } from "../components/ui/card";

export async function portalHomeLoader() {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const [typesRes, linksRes, requestsRes] = await Promise.all([
    api.GET("/api/v1/portal/request-types"),
    api.GET("/api/v1/portal/intake-links"),
    // Scoped to the session by the route itself (DD-013). The home asks
    // for "my requests" and there is no other list to ask for.
    api.GET("/api/v1/portal/requests"),
  ]);
  if (!typesRes.data || !linksRes.data || !requestsRes.data) {
    throw new Error("The portal home could not be read.");
  }
  return {
    user,
    requestTypes: typesRes.data.requestTypes,
    deflectionLinks: linksRes.data.intakeLinks,
    requests: requestsRes.data.requests,
  };
}

const TITLE = defineMessage({
  id: "portal.home.title",
  defaultMessage: "What do you need from Legal?",
});

export function PortalHomePage() {
  const { user, requestTypes, deflectionLinks, requests } =
    useLoaderData<typeof portalHomeLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    void navigate("/portal/enter", { replace: true });
  }

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(TITLE)} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage {...TITLE} />
        </h1>
        {requestTypes.length > 0 && (
          <p className="text-base text-muted">
            <FormattedMessage
              id="portal.home.lead"
              defaultMessage="Pick a request type — the form collects what Legal needs to get started."
            />
          </p>
        )}
      </div>
      {requestTypes.length > 0 ? (
        <ul
          id={REQUEST_TYPE_PICKER_ID}
          // The empty my-requests block points here. A scroll target is
          // not a focus target on its own, so the list takes the focus
          // the jump sends it and a keyboard reader arrives at the
          // cards rather than back at the top of the page (DES-011).
          tabIndex={-1}
          aria-label={intl.formatMessage({
            id: "portal.home.pickerLabel",
            defaultMessage: "Request types",
          })}
          className="grid grid-cols-portal-picker gap-3"
        >
          {requestTypes.map((type) => (
            <li key={type.id} className="flex">
              <Link
                to={`/portal/new/${type.slug}`}
                className="flex w-full flex-col gap-2 rounded-card border border-border-default bg-raised p-4 transition-colors duration-150 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
              >
                <span className="text-base font-semibold">{type.displayName}</span>
                {type.description !== null && (
                  <span className="text-sm text-muted">{type.description}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        /* Not a placeholder: an instance whose Administrator has
           archived every request type says exactly this, and so does
           one that has configured none yet. */
        <Card>
          <CardContent className="text-md text-muted">
            <FormattedMessage
              id="portal.home.noTypes"
              defaultMessage="No request types are available yet. Ask your legal team to open one."
            />
          </CardContent>
        </Card>
      )}
      <DeflectionPanel links={deflectionLinks} />
      {/* Last on the page, as I5 stacks it: the picker is what a first
          visit needs, and a returning requester scrolls to the list
          that is theirs. */}
      <MyRequests requests={requests} hasRequestTypes={requestTypes.length > 0} />
    </PortalShell>
  );
}
