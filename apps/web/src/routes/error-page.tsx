// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, useIntl } from "react-intl";
import { Button } from "../components/ui/button";
import { PageTitle } from "../components/page-title";

/** Router-level error boundary: a loader threw (API unreachable,
 * 5xx). Sets its own document title per DES-011. */
export function RouteErrorPage() {
  const intl = useIntl();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-page-x text-primary">
      <PageTitle
        title={intl.formatMessage({
          id: "error.pageTitle",
          defaultMessage: "Something went wrong",
        })}
      />
      <h1 className="text-xl font-semibold">
        <FormattedMessage id="error.title" defaultMessage="Something went wrong." />
      </h1>
      <p className="text-md text-muted">
        <FormattedMessage
          id="error.body"
          defaultMessage="The page could not load. Reload to try again."
        />
      </p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        <FormattedMessage id="action.reload" defaultMessage="Reload" />
      </Button>
    </div>
  );
}
