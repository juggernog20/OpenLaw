// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage } from "react-intl";
import { Button } from "../components/ui/button";

/** Router-level error boundary: a loader threw (API unreachable, 5xx). */
export function RouteErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-page-x text-primary">
      <h1 className="text-xl font-semibold">
        <FormattedMessage id="error.title" defaultMessage="Something went wrong." />
      </h1>
      <p className="text-md text-muted">
        <FormattedMessage
          id="error.body"
          defaultMessage="The server could not be reached. Check your connection, then reload."
        />
      </p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        <FormattedMessage id="action.reload" defaultMessage="Reload" />
      </Button>
    </div>
  );
}
