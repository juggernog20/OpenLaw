// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-029 consent on DES-092's MC5 card. The Client acts as the signed-in
 * person. Nothing is preselected, and the organization's read-only rule wins.
 */

import { useRef, useState } from "react";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Lock } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import type { McpToolset } from "@openlaw/shared";
import { api } from "../lib/api";
import { toolsetLabel } from "../lib/mcp";
import { roleLabel } from "../lib/roles";
import { networkError } from "../lib/messages";
import { Avatar, clientInitials } from "../components/avatar";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { AuthCanvas } from "./auth-layout";

type Facts =
  paths["/api/v1/oauth-grants/consent"]["get"]["responses"][200]["content"]["application/json"];
const refusals = defineMessages({
  expired_query: {
    id: "consent.expired",
    defaultMessage: "This consent request has expired or changed. Start again from your Client.",
  },
  mcp_disabled: { id: "consent.mcpDisabled", defaultMessage: "MCP is off for this organization." },
  group_disabled: {
    id: "consent.groupDisabled",
    defaultMessage: "OAuth Clients are off for your account type.",
  },
  client_unlisted: {
    id: "consent.clientUnlisted",
    defaultMessage: "This Client is not on the organization's Allowed Clients list.",
  },
  client_disabled: {
    id: "consent.clientDisabled",
    defaultMessage: "This Client is off in the organization's Allowed Clients list.",
  },
});

export async function consentLoader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  const oauth_query = search.slice(1);
  const { data, error, response } = await api.GET("/api/v1/oauth-grants/consent", {
    params: { query: { oauth_query } },
    signal: request.signal,
  });
  if (response.status === 401) return redirect(`/auth/login${search}`);
  if (!data) throw new Error(error?.detail ?? "The consent request could not be read.");
  return { facts: data, oauth_query };
}

export function ConsentPage() {
  const loaded = useLoaderData<typeof consentLoader>() as Exclude<
    Awaited<ReturnType<typeof consentLoader>>,
    Response
  >;
  // A different signed request must start with empty choices.
  return (
    <Consent key={loaded.oauth_query} initial={loaded.facts} oauthQuery={loaded.oauth_query} />
  );
}

function Consent({ initial, oauthQuery }: { initial: Facts; oauthQuery: string }) {
  const intl = useIntl();
  const [facts, setFacts] = useState(initial);
  const [toolsets, setToolsets] = useState<McpToolset[]>([]);
  const [scope, setScope] = useState<"read" | "write">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const { client, person, refusalReason } = facts;
  const allowed = !refusalReason && !!client;
  const expired = refusalReason === "expired_query";

  async function answer(accept: boolean) {
    if (lock.current || expired || (accept && (!allowed || !scope || !toolsets.length))) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.POST("/api/v1/oauth-grants/consent", {
        body: accept
          ? { accept: true, oauth_query: oauthQuery, toolsets, scope: scope! }
          : { accept: false, oauth_query: oauthQuery },
      });
      if (data) {
        window.location.assign(data.url);
        return;
      }
      if (response.status === 401) {
        window.location.assign(`/auth/login?${oauthQuery}`);
        return;
      }
      // Expiry and policy can change while the person makes their choices.
      const current = await api.GET("/api/v1/oauth-grants/consent", {
        params: { query: { oauth_query: oauthQuery } },
      });
      if (current.data) {
        setFacts(current.data);
        setToolsets((chosen) => chosen.filter((t) => current.data!.toolsets.includes(t)));
        if (!current.data.writeOffered && scope === "write") setScope(undefined);
        if (current.data.refusalReason) return;
      }
      setError(
        problem?.detail ??
          intl.formatMessage({
            id: "consent.answerFailed",
            defaultMessage: "Your answer could not be saved. Try again.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthCanvas>
      <PageTitle
        title={intl.formatMessage({ id: "consent.pageTitle", defaultMessage: "Client consent" })}
      />
      <Card className="@container/consent w-full max-w-(--width-consent-card) overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border-default px-6 pt-6 pb-5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-md font-semibold">
              <FormattedMessage id="consent.wordmark" defaultMessage="openlaw" />
            </span>
            <span className="min-w-0 break-words text-sm text-secondary">
              {facts.organizationName}
            </span>
          </div>
          {client ? (
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-card border border-border-default bg-control text-base font-semibold"
              >
                {clientInitials(client.name)}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold">
                  <FormattedMessage
                    id="consent.title"
                    defaultMessage="{client} wants to work in OpenLaw as you"
                    values={{ client: client.name }}
                  />
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-secondary">
                  <span>
                    {client.kind === "published" ? (
                      <FormattedMessage
                        id="allowedClients.published"
                        defaultMessage="Published identity"
                      />
                    ) : (
                      <FormattedMessage
                        id="allowedClients.registered"
                        defaultMessage="Registered client"
                      />
                    )}
                  </span>
                  <span className="break-all">{client.identityCaption}</span>
                  {allowed && (
                    <span className="rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-fg">
                      <FormattedMessage
                        id="consent.allowedClient"
                        defaultMessage="Allowed Client"
                      />
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <h1 className="text-lg font-semibold">
              <FormattedMessage id="consent.pageTitle" defaultMessage="Client consent" />
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-2.5 rounded-button bg-control px-3 py-2">
            <Avatar name={person.displayName} image={person.image} className="size-6" />
            <span className="break-words text-base font-semibold">{person.displayName}</span>
            <span className="text-sm text-secondary">{roleLabel(intl, person.role)}</span>
            <span className="break-all text-sm text-secondary">{person.email}</span>
          </div>
        </div>
        {allowed ? (
          <div className="flex flex-col gap-4 px-6 py-5">
            <fieldset disabled={busy}>
              <legend className="mb-2 text-sm font-medium">
                <FormattedMessage
                  id="consent.toolsets"
                  defaultMessage="What {client} may use"
                  values={{ client: client.name }}
                />
              </legend>
              <p className="mb-3 text-right text-sm text-secondary">
                <FormattedMessage
                  id="apiKeys.nothingSelected"
                  defaultMessage="Nothing is selected for you."
                />
              </p>
              <div className="grid grid-cols-2 gap-3 @sm/consent:grid-cols-3">
                {facts.toolsets.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-base">
                    <Checkbox
                      checked={toolsets.includes(t)}
                      onCheckedChange={(checked) =>
                        setToolsets((chosen) =>
                          checked ? [...chosen, t] : chosen.filter((v) => v !== t),
                        )
                      }
                    />
                    {toolsetLabel(intl, t)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy} className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-medium">
                <FormattedMessage
                  id="consent.scope"
                  defaultMessage="How far {client} may go"
                  values={{ client: client.name }}
                />
              </legend>
              <label className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="scope"
                  className="mt-1"
                  checked={scope === "read"}
                  onChange={() => setScope("read")}
                  aria-labelledby="consent-read"
                  aria-describedby="consent-read-description"
                />
                <span>
                  <span id="consent-read" className="block text-base font-medium">
                    <FormattedMessage id="consent.read" defaultMessage="Read only" />
                  </span>
                  <span id="consent-read-description" className="block text-sm text-secondary">
                    <FormattedMessage
                      id="consent.readDescription"
                      defaultMessage="{client} can list and read what you can see."
                      values={{ client: client.name }}
                    />
                  </span>
                </span>
              </label>
              {facts.writeOffered && (
                <label className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="scope"
                    className="mt-1"
                    checked={scope === "write"}
                    onChange={() => setScope("write")}
                    aria-labelledby="consent-write"
                    aria-describedby="consent-write-description"
                  />
                  <span>
                    <span id="consent-write" className="block text-base font-medium">
                      <FormattedMessage id="consent.write" defaultMessage="Read and write" />
                    </span>
                    <span id="consent-write-description" className="block text-sm text-secondary">
                      <FormattedMessage
                        id="consent.writeDescription"
                        defaultMessage="{client} can also create and change records, as you. Every change is recorded as you, via {client}."
                        values={{ client: client.name }}
                      />
                    </span>
                  </span>
                </label>
              )}
            </fieldset>
            <p className="flex items-center gap-2 rounded-button border border-border-muted bg-legal-only-bg px-3 py-2.5 text-sm font-medium">
              <Lock aria-hidden="true" size={16} className="shrink-0" />
              <FormattedMessage
                id="consent.reach"
                defaultMessage="This Client can never see or change what you cannot."
              />
            </p>
          </div>
        ) : (
          refusalReason && (
            <p className="px-6 py-5 text-md">
              <FormattedMessage {...refusals[refusalReason]} />
            </p>
          )
        )}
        {error && (
          <p role="alert" className="px-6 pb-4 text-status-danger-fg">
            {error}
          </p>
        )}
        {!expired && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-default bg-section-header px-6 py-3">
            {allowed && (
              <p className="min-w-0 flex-1 text-xs text-secondary">
                {person.role === "business_user" ? (
                  <FormattedMessage
                    id="consent.disconnectPortal"
                    defaultMessage="You can disconnect {client} later from Portal settings → API keys."
                    values={{ client: client.name }}
                  />
                ) : (
                  <FormattedMessage
                    id="consent.disconnect"
                    defaultMessage="You can disconnect {client} later from Settings → API keys."
                    values={{ client: client.name }}
                  />
                )}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void answer(false)}>
                <FormattedMessage id="apiKeys.deny" defaultMessage="Deny" />
              </Button>
              {allowed && (
                <Button
                  disabled={busy || !toolsets.length || !scope}
                  onClick={() => void answer(true)}
                >
                  <FormattedMessage id="consent.allow" defaultMessage="Allow" />
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </AuthCanvas>
  );
}
