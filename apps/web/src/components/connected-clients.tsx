// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Connected Clients card of DES-092's MC2: one DsRow per OAuth grant
 * the signed-in person holds, with Disconnect on the right. The staff
 * pane and the Portal settings surface mount the same card.
 */

import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { toolsetLabel } from "../lib/mcp";
import { clientInitials } from "./avatar";
import { SettingsCard } from "./settings-card";
import { Button } from "./ui/button";
import { Scope } from "./mcp-scope";

type Grant =
  paths["/api/v1/oauth-grants"]["get"]["responses"][200]["content"]["application/json"][number];

export function ConnectedClients({
  grants,
  busy,
  onDisconnect,
}: {
  grants: Grant[];
  busy: boolean;
  onDisconnect: (grant: Grant) => void;
}) {
  const intl = useIntl();
  const date = (value: string) => intl.formatDate(value, { dateStyle: "medium" });
  return (
    <SettingsCard
      title={<FormattedMessage id="connectedClients.title" defaultMessage="Connected Clients" />}
      region
      collapsible
    >
      {grants.length ? (
        <ul className="divide-y divide-border-default">
          {grants.map((grant) => (
            <li key={grant.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-button border border-border-default bg-control text-sm font-semibold"
              >
                {clientInitials(grant.clientName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{grant.clientName}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span>{grant.toolsets.map((t) => toolsetLabel(intl, t)).join(", ")}</span>
                  <Scope scope={grant.scope} />
                  <span className="text-muted">
                    <FormattedMessage
                      id="connectedClients.granted"
                      defaultMessage="Granted {date}"
                      values={{ date: date(grant.grantedAt) }}
                    />
                  </span>
                  <span className="text-muted">
                    <FormattedMessage
                      id="connectedClients.lastUsed"
                      defaultMessage="Last used {date}"
                      values={{
                        date: grant.lastUsedAt
                          ? date(grant.lastUsedAt)
                          : intl.formatMessage({
                              id: "connectedClients.never",
                              defaultMessage: "Never",
                            }),
                      }}
                    />
                  </span>
                </div>
              </div>
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={busy}
                aria-label={intl.formatMessage(
                  { id: "connectedClients.disconnectNamed", defaultMessage: "Disconnect {client}" },
                  { client: grant.clientName },
                )}
                onClick={() => onDisconnect(grant)}
              >
                <FormattedMessage id="connectedClients.disconnect" defaultMessage="Disconnect" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          <FormattedMessage id="connectedClients.empty" defaultMessage="No Client is connected." />
        </p>
      )}
      <p className="text-sm text-muted">
        <FormattedMessage
          id="connectedClients.help"
          defaultMessage="A Client on the Allowed Clients list asks to connect from inside the Client. You choose its Toolsets and scope on the consent page."
        />
      </p>
    </SettingsCard>
  );
}
