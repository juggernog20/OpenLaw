// SPDX-License-Identifier: AGPL-3.0-only

import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { contractReference, stageLabel } from "../lib/contracts";
import { PortalShell } from "../components/portal/portal-shell";
import { PortalBackLink } from "../components/portal/back-link";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";

export async function portalContractsLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const requestedCursor = Number(new URL(request.url).searchParams.get("cursor"));
  const cursor =
    Number.isSafeInteger(requestedCursor) && requestedCursor > 0 ? requestedCursor : null;
  const { data } = await api.GET("/api/v1/portal/contracts", {
    params: { query: cursor ? { cursor } : {} },
  });
  if (!data) throw new Error("Your Contracts could not be read.");
  return { user, ...data, cursor };
}

export function PortalContractsPage() {
  const { user, contracts, nextCursor, cursor } = useLoaderData<typeof portalContractsLoader>();
  const signOut = useSignOut("/portal/enter");
  const intl = useIntl();
  const title = intl.formatMessage({
    id: "portal.contracts.title",
    defaultMessage: "Your Contracts",
  });
  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <PortalBackLink>
        <FormattedMessage id="portal.contracts.requests" defaultMessage="Your requests" />
      </PortalBackLink>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-base text-muted">
        <FormattedMessage
          id="portal.contracts.description"
          defaultMessage="Contracts where you are the Business Owner or a stakeholder."
        />
      </p>
      {contracts.length === 0 ? (
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.contracts.empty"
            defaultMessage="No Contracts are available to you."
          />
        </p>
      ) : (
        <ul className="divide-y divide-border-muted overflow-hidden rounded-card border border-border-default bg-raised">
          {contracts.map((contract) => (
            <li key={contract.number}>
              <Link
                to={`/portal/contracts/${contract.number}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-link hover:bg-canvas focus-visible:outline-2 focus-visible:outline-link"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm text-muted">
                    {contractReference(intl, contract.number)}
                  </span>
                  <span className="text-md font-semibold">{contract.title}</span>
                  <span className="text-base text-muted">{contract.counterparty}</span>
                </span>
                <span className="text-sm text-muted">{stageLabel(intl, contract.stage)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label={intl.formatMessage({
          id: "portal.contracts.pagination",
          defaultMessage: "Contract pages",
        })}
        className="flex gap-3"
      >
        {cursor && (
          <Button asChild variant="secondary">
            <Link to="/portal/contracts">
              <FormattedMessage id="portal.contracts.firstPage" defaultMessage="First page" />
            </Link>
          </Button>
        )}
        {nextCursor && (
          <Button asChild variant="secondary">
            <Link to={`/portal/contracts?cursor=${encodeURIComponent(nextCursor)}`}>
              <FormattedMessage id="portal.contracts.nextPage" defaultMessage="Next page" />
            </Link>
          </Button>
        )}
      </nav>
    </PortalShell>
  );
}
