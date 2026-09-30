// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DocuSign consent step (#1236), shared by the E-signature pane and
 * the onboarding E-signature step.
 *
 * JWT grant needs the API user to consent to the integration once.
 * DocuSign's console has no button for that. The only way is to open an
 * OAuth URL built from the environment and the integration key, and
 * DocuSign only accepts that URL when its `redirect_uri` is registered
 * on the app. This module builds the URL, opens it in a popup, shows
 * the redirect URI to register, and carries the popup's answer back.
 *
 * The answer travels on a BroadcastChannel, not `window.opener`.
 * DocuSign's sign-in pages can set a cross-origin opener policy, which
 * cuts the popup off from its opener, but a same-origin channel still
 * reaches it. Each popup carries a random `state`, and the opener
 * ignores any answer whose `state` it did not issue.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** Where DocuSign sends the popup back to. A route of its own, outside
 * the settings shell, because it draws inside a small popup. */
export const DOCUSIGN_CONSENT_PATH = "/settings/integrations/e-signature/docusign-consent";

/** The channel the callback page announces its result on. */
const CONSENT_CHANNEL = "openlaw:docusign-consent";

/** DocuSign's account server for each environment (TECH-013). */
const CONSENT_HOSTS = {
  demo: "https://account-d.docusign.com",
  production: "https://account.docusign.com",
} as const;

export type DocusignEnvironment = keyof typeof CONSENT_HOSTS;

/** What the callback page reports back to the form that opened it. */
export type ConsentResult =
  | { state: string; outcome: "granted" }
  | { state: string; outcome: "refused"; error: string; description: string | null };

/**
 * The redirect URI to register on the DocuSign app.
 *
 * Built from the browser's own origin, not the API's base URL. The
 * redirect is a browser navigation, and the callback page can only
 * reach the form that opened it on the same origin.
 */
export function consentRedirectUri(origin: string = window.location.origin): string {
  return new URL(DOCUSIGN_CONSENT_PATH, origin).toString();
}

/**
 * The URL that asks DocuSign for the API user's consent.
 *
 * Encoded by hand rather than by URLSearchParams, so the scope's space
 * goes out as `%20`, which is the form DocuSign documents.
 */
export function docusignConsentUrl(input: {
  environment: DocusignEnvironment;
  integrationKey: string;
  redirectUri: string;
  state: string;
}): string {
  const query = (
    [
      ["response_type", "code"],
      ["scope", "signature impersonation"],
      ["client_id", input.integrationKey.trim()],
      ["redirect_uri", input.redirectUri],
      ["state", input.state],
    ] as const
  )
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&");
  return `${CONSENT_HOSTS[input.environment]}/oauth/auth?${query}`;
}

/** A random `state` value. `getRandomValues`, not `randomUUID`, because
 * the second exists only on secure origins and an install on a plain
 * http LAN address is still an install. */
function newState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Sends the callback page's result to every same-origin page listening. */
export function announceConsentResult(result: ConsentResult): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CONSENT_CHANNEL);
  channel.postMessage(result);
  channel.close();
}

function isConsentResult(value: unknown): value is ConsentResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.state === "string" &&
    (record.outcome === "granted" ||
      (record.outcome === "refused" && typeof record.error === "string"))
  );
}

/**
 * The opener's half of the consent step.
 *
 * `grant` opens the popup. When DocuSign answers, a granted consent
 * calls `onGranted`, which re-runs the connection test, and a refusal
 * lands in `consentError` for the form to show.
 */
export function useDocusignConsent(onGranted: () => void) {
  const intl = useIntl();
  const issued = useRef(new Set<string>());
  const granted = useRef(onGranted);
  useEffect(() => {
    granted.current = onGranted;
  }, [onGranted]);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CONSENT_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const result = event.data;
      if (!isConsentResult(result) || !issued.current.delete(result.state)) return;
      if (result.outcome === "granted") {
        setConsentError(null);
        granted.current();
        return;
      }
      setConsentError(
        intl.formatMessage(
          {
            id: "docusignConsent.refused",
            defaultMessage: "DocuSign did not grant consent: {reason}",
          },
          { reason: result.description ?? result.error },
        ),
      );
    };
    return () => channel.close();
  }, [intl]);

  const grant = useCallback((environment: DocusignEnvironment, integrationKey: string) => {
    const state = newState();
    issued.current.add(state);
    setConsentError(null);
    window.open(
      docusignConsentUrl({
        environment,
        integrationKey,
        redirectUri: consentRedirectUri(),
        state,
      }),
      "openlaw-docusign-consent",
      "popup,width=520,height=720",
    );
  }, []);

  return { grant, consentError };
}

/** The Grant consent button. Disabled until there is an integration key
 * to put in the URL. */
export function GrantConsentButton(
  props: Readonly<{
    environment: DocusignEnvironment | null;
    integrationKey: string;
    onGrant: (environment: DocusignEnvironment, integrationKey: string) => void;
    disabled?: boolean;
  }>,
) {
  const { environment, integrationKey } = props;
  const ready = environment !== null && integrationKey.trim() !== "";
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={props.disabled === true || !ready}
      onClick={() => {
        if (ready) props.onGrant(environment, integrationKey);
      }}
    >
      <FormattedMessage id="docusignConsent.grant" defaultMessage="Grant consent" />
    </Button>
  );
}

/**
 * The redirect URI, read-only, with a copy button. The same shape as
 * the pane's webhook URL field.
 */
export function ConsentRedirectField(props: Readonly<{ id: string; help?: ReactNode }>) {
  const uri = consentRedirectUri();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard leaves the field on
      // screen to select by hand.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={props.id}
        help={
          <FormattedMessage
            id="docusignConsent.redirectUri.hint"
            defaultMessage="Add this address once under Redirect URIs on your DocuSign app. DocuSign refuses the consent step until it is there."
          />
        }
      >
        <FormattedMessage id="docusignConsent.redirectUri" defaultMessage="Consent redirect URI" />
      </Label>
      <div className="flex gap-2">
        <Input id={props.id} className="w-80 max-w-full" readOnly value={uri} />
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? (
            <FormattedMessage id="action.copied" defaultMessage="Copied" />
          ) : (
            <FormattedMessage id="action.copy" defaultMessage="Copy" />
          )}
        </Button>
      </div>
    </div>
  );
}
