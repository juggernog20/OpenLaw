// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023: the paginated Portal list of Matters shared with the signed-in person. */
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { matterReference } from "../lib/matters";
import { PortalShell } from "../components/portal/portal-shell";
import { PortalBackLink } from "../components/portal/back-link";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";

export async function portalMattersLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const requestedCursor = Number(new URL(request.url).searchParams.get("cursor"));
  const cursor =
    Number.isSafeInteger(requestedCursor) && requestedCursor > 0 ? requestedCursor : null;
  const { data } = await api.GET("/api/v1/portal/matters", {
    params: { query: cursor ? { cursor } : {} },
  });
  if (!data) throw new Error("Your Matters could not be read.");
  return { user, ...data, cursor };
}

export function PortalMattersPage() {
  const { user, matters, nextCursor, cursor } = useLoaderData<typeof portalMattersLoader>();
  const signOut = useSignOut("/portal/enter");
  const intl = useIntl();
  const title = intl.formatMessage({
    id: "portal.matters.title",
    defaultMessage: "Your Matters",
  });
  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <PortalBackLink>
        <FormattedMessage id="portal.matters.requests" defaultMessage="Your requests" />
      </PortalBackLink>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-base text-muted">
        <FormattedMessage
          id="portal.matters.description"
          defaultMessage="Matters you are on the team for."
        />
      </p>
      {matters.length === 0 ? (
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.matters.empty"
            defaultMessage="No Matters are available to you."
          />
        </p>
      ) : (
        <ul className="divide-y divide-border-muted overflow-hidden rounded-card border border-border-default bg-raised">
          {matters.map((matter) => (
            <li key={matter.number}>
              <Link
                to={`/portal/matters/${matter.number}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-link hover:bg-canvas focus-visible:outline-2 focus-visible:outline-link"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm text-muted">{matterReference(intl, matter.number)}</span>
                  <span className="text-md font-semibold">{matter.title}</span>
                  <span className="text-base text-muted">{matter.type}</span>
                </span>
                <span className="text-sm text-muted">{matter.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label={intl.formatMessage({
          id: "portal.matters.pagination",
          defaultMessage: "Matter pages",
        })}
        className="flex gap-3"
      >
        {cursor && (
          <Button asChild variant="secondary">
            <Link to="/portal/matters">
              <FormattedMessage id="portal.matters.firstPage" defaultMessage="First page" />
            </Link>
          </Button>
        )}
        {nextCursor && (
          <Button asChild variant="secondary">
            <Link to={`/portal/matters?cursor=${encodeURIComponent(nextCursor)}`}>
              <FormattedMessage id="portal.matters.nextPage" defaultMessage="Next page" />
            </Link>
          </Button>
        )}
      </nav>
    </PortalShell>
  );
}
