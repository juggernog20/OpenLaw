// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal home (INT-001), from the I5 frame of intake.pen: where a
 * redeemed magic link lands, and the front door to intake.
 *
 * The loader gates on a session and nothing else. A Business User is
 * routed here from the staff application (see `homeLoader`), and Member+
 * staff are admitted rather than turned away. Staff ask legal questions
 * too, and on this surface they are a Requester like anybody else.
 *
 * The body is the request type picker, the "Before you submit" panel,
 * and the my-requests list, in the order I5 stacks them.
 *
 * The picker draws the Administrator's live types in their order.
 * Both reads come from the portal's own requester-facing routes, not
 * from the Administrator-facing Intake Settings ones. Those stay shut
 * to a Business User, which is why the portal mount exists.
 *
 * The picker is the only thing the empty state replaces. An instance
 * whose Administrator has archived every request type says so where
 * the cards would be. The heading above it and the deflection panel
 * below it are unaffected, because a deflection link is still worth
 * following when there is no form to fill in.
 *
 * Recorded normalization points (I5 deviations accepted):
 *
 * 1. I5 draws a per-type lucide glyph beside each name (`file-pen`,
 *    `shield`, `package`, and so on). A request type carries a slug, a
 *    name, a description, an order, and a target (INT-002), and no
 *    icon, so the card head is the name alone rather than one glyph
 *    repeated down the grid.
 * 2. I5 lays the cards out as two hand-built rows of three. They render
 *    as one auto-filling grid, per DES-012's preference for intrinsic
 *    layout over fixed rows: an Administrator may configure any number
 *    of types, and the mock's six is not the count.
 * 3. I5 stacks the three blocks in one column. From @3xl of the page
 *    container the deflection panel moves into an aside beside the
 *    picker (`grid-cols-portal-split`), with the list spanning both columns.
 *    The reading sits next to the doors.
 *    Below that width the mock's order holds: picker, panel, list.
 */

import { Link, redirect, useLoaderData } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { ArrowRight, FolderOpen } from "lucide-react";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { DeflectionPanel } from "../components/portal/deflection-panel";
import { MyRequests, REQUEST_TYPE_PICKER_ID } from "../components/portal/my-requests";
import { PortalShell } from "../components/portal/portal-shell";

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

  const signOut = useSignOut("/portal/enter");

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(TITLE)} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage {...TITLE} />
        </h1>
        {requestTypes.length > 0 && (
          <p className="max-w-prose text-md text-muted">
            <FormattedMessage
              id="portal.home.lead"
              defaultMessage="Pick a request type — the form collects what Legal needs to get started."
            />
          </p>
        )}
      </div>
      <div className="grid gap-section-gap @3xl/page:grid-cols-portal-split">
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
            className="grid grid-cols-portal-picker gap-3 @3xl/page:col-start-1"
          >
            {requestTypes.map((type) => (
              <li key={type.id} className="flex">
                <Link
                  to={`/portal/new/${type.slug}`}
                  className="group flex w-full items-start justify-between gap-3 rounded-card border border-border-default bg-raised p-4 transition-colors duration-150 hover:border-border-strong hover:bg-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-md font-semibold text-primary">{type.displayName}</span>
                    {type.description !== null && (
                      <span className="text-sm text-muted">{type.description}</span>
                    )}
                  </span>
                  {/* The door's arrow: it says the card opens something,
                      and steps forward on hover within DES-003's 200ms. */}
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-subtle transition-[color,translate] duration-150 group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          /* Not a placeholder: an instance whose Administrator has
             archived every request type says exactly this, and so does
             one that has configured none yet. */
          <div className="flex flex-col items-center gap-2 rounded-card border border-border-default bg-raised px-4 py-10 text-center @3xl/page:col-start-1">
            <FolderOpen aria-hidden="true" className="size-6 text-subtle" />
            <p className="text-md text-muted">
              <FormattedMessage
                id="portal.home.noTypes"
                defaultMessage="No request types are available yet. Ask your legal team to open one."
              />
            </p>
          </div>
        )}
        {/* Second in the DOM, so a narrow page reads picker, panel, list
            as I5 stacks them; the aside slot is where it goes once there
            is room beside the column. */}
        <aside className="flex flex-col gap-4 @3xl/page:col-start-2 @3xl/page:row-start-1 @3xl/page:self-start">
          <DeflectionPanel links={deflectionLinks} />
        </aside>
        {/* Last in the column, as I5 stacks it: the picker is what a
            first visit needs, and a returning requester scrolls to the
            list that is theirs. */}
        <div className="min-w-0 @3xl/page:col-span-2">
          <MyRequests requests={requests} hasRequestTypes={requestTypes.length > 0} />
        </div>
      </div>
    </PortalShell>
  );
}
