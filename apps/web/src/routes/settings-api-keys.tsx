// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SET-014 API keys on the Personal rail and Portal settings. Each shell uses the
 * same table and dialogs; loaders read metadata without consuming a key.
 */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { requireUser, currentUserFor, useSignOut } from "../lib/session";
import { ApiKeys } from "../components/api-keys";
import { PageTitle } from "../components/page-title";
import { PortalShell } from "../components/portal/portal-shell";
import { PortalBackLink } from "../components/portal/back-link";
async function readKeys() {
  const [{ data: keys }, { data: grants }] = await Promise.all([
    api.GET("/api/v1/api-key-requests"),
    api.GET("/api/v1/oauth-grants"),
  ]);
  if (!keys || !grants) throw new Error("API keys and Connected Clients could not be read.");
  return { keys, grants };
}
export async function settingsApiKeysLoader() {
  const user = await requireUser();
  if (user.role === "business_user") return redirect("/portal/settings/api-keys");
  return { user, ...(await readKeys()) };
}
export async function portalApiKeysLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/login");
  return { user, ...(await readKeys()) };
}
export function SettingsApiKeysPage() {
  const { keys, grants } = useLoaderData<typeof settingsApiKeysLoader>();
  const intl = useIntl();
  return (
    <>
      <PageTitle title={intl.formatMessage({ id: "apiKeys.title", defaultMessage: "API keys" })} />
      <ApiKeys initial={keys} initialGrants={grants} />
    </>
  );
}
export function PortalApiKeysPage() {
  const { user, keys, grants } = useLoaderData<typeof portalApiKeysLoader>();
  const signOut = useSignOut("/portal/login");
  const intl = useIntl();
  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage({ id: "apiKeys.title", defaultMessage: "API keys" })} />
      <PortalBackLink>
        <FormattedMessage id="portal.request.back" defaultMessage="Your requests" />
      </PortalBackLink>
      <h1 className="text-2xl font-semibold">
        <FormattedMessage id="apiKeys.title" defaultMessage="API keys" />
      </h1>
      <ApiKeys initial={keys} initialGrants={grants} />
    </PortalShell>
  );
}
