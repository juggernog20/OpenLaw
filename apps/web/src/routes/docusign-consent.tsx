// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where DocuSign sends the consent popup back to (#1236).
 *
 * JWT grant needs the consent and nothing else, so an authorization
 * `code` is dropped unread: it is never sent anywhere, and the address
 * bar loses it at once. The page then tells the form that opened it
 * what happened. A granted consent closes the popup, and the form
 * re-runs its connection test. A refusal stays on screen here, in
 * DocuSign's own words, and the form shows it too.
 *
 * The page needs no session and reads no data, so it has no loader.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { FormattedMessage } from "react-intl";
import { announceConsentResult, type ConsentResult } from "../components/docusign-consent";

type Reading = ConsentResult | { outcome: "none" };

function read(search: string): Reading {
  const params = new URLSearchParams(search);
  const state = params.get("state") ?? "";
  const error = params.get("error");
  if (error) {
    return {
      state,
      outcome: "refused",
      error,
      description: params.get("error_description") ?? params.get("error_message"),
    };
  }
  if (params.has("code")) return { state, outcome: "granted" };
  return { outcome: "none" };
}

export function DocusignConsentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Read once. The query goes from the address bar below, and the
  // answer must outlive it.
  const [reading] = useState(() => read(location.search));

  // Once, on arrival. Dropping the query changes `location`, and the
  // result must not be announced twice.
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || reading.outcome === "none") return;
    announced.current = true;
    announceConsentResult(reading);
    void navigate(location.pathname, { replace: true });
    // A granted consent needs nothing more from the admin. A browser
    // that refuses to close the window leaves the success text below.
    if (reading.outcome === "granted") window.close();
  }, [reading, navigate, location.pathname]);

  return (
    <main className="mx-auto max-w-xl p-8">
      {reading.outcome === "granted" && (
        <>
          <h1 className="text-xl font-semibold text-primary">
            <FormattedMessage id="docusignConsent.granted.title" defaultMessage="Consent granted" />
          </h1>
          <p className="mt-4 text-base text-primary">
            <FormattedMessage
              id="docusignConsent.granted.body"
              defaultMessage="OpenLaw is testing the connection again. You can close this window."
            />
          </p>
        </>
      )}
      {reading.outcome === "refused" && (
        <>
          <h1 className="text-xl font-semibold text-primary">
            <FormattedMessage
              id="docusignConsent.refused.title"
              defaultMessage="DocuSign did not grant consent"
            />
          </h1>
          <p role="alert" className="mt-4 text-base text-status-danger-fg">
            {reading.description ?? reading.error}
          </p>
          <p className="mt-4 text-base text-primary">
            <FormattedMessage
              id="docusignConsent.refused.body"
              defaultMessage="Close this window, check the integration key and the redirect URI on the DocuSign app, then select Grant consent again."
            />
          </p>
        </>
      )}
      {reading.outcome === "none" && (
        <>
          <h1 className="text-xl font-semibold text-primary">
            <FormattedMessage
              id="docusignConsent.none.title"
              defaultMessage="No consent answer to show"
            />
          </h1>
          <p className="mt-4 text-base text-primary">
            <FormattedMessage
              id="docusignConsent.none.body"
              defaultMessage="DocuSign returns here after the consent step. Start it with Grant consent in Settings, under Integrations, E-signature."
            />
          </p>
        </>
      )}
    </main>
  );
}
