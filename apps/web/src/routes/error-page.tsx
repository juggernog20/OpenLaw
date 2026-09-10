// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "../components/ui/button";
import { PageTitle } from "../components/page-title";
import { NOT_FOUND_BODY, NOT_FOUND_HOME, NOT_FOUND_PAGE_TITLE, NOT_FOUND_TITLE } from "./not-found";

const ERROR_PAGE_TITLE = defineMessage({
  id: "error.pageTitle",
  defaultMessage: "Something went wrong",
});

/**
 * Router-level error boundary. A loader threw (API unreachable, 5xx),
 * or the router matched nothing at a level with no splat route and
 * raised its own 404. The 404 gets the not-found copy; everything else
 * gets the crash copy and a Reload. Both offer the way home and set
 * their own document title (DES-011).
 */
export function RouteErrorPage() {
  const intl = useIntl();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-page-x text-primary">
      <PageTitle title={intl.formatMessage(notFound ? NOT_FOUND_PAGE_TITLE : ERROR_PAGE_TITLE)} />
      <h1 className="text-xl font-semibold">
        {notFound ? (
          <FormattedMessage {...NOT_FOUND_TITLE} />
        ) : (
          <FormattedMessage id="error.title" defaultMessage="Something went wrong." />
        )}
      </h1>
      <p className="text-md text-muted">
        {notFound ? (
          <FormattedMessage {...NOT_FOUND_BODY} />
        ) : (
          <FormattedMessage
            id="error.body"
            defaultMessage="The page could not load. Reload to try again."
          />
        )}
      </p>
      <div className="flex items-center gap-2">
        {notFound ? null : (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <FormattedMessage id="action.reload" defaultMessage="Reload" />
          </Button>
        )}
        <Button asChild variant={notFound ? "secondary" : "link"}>
          <Link to="/">
            <FormattedMessage {...NOT_FOUND_HOME} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
