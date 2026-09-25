// SPDX-License-Identifier: AGPL-3.0-only
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { toolsetLabel } from "../lib/mcp";
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
        <ul className="flex flex-col gap-4">
          {grants.map((grant) => (
            <li key={grant.id} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-button border border-border-default bg-control text-sm font-semibold"
                >
                  {grant.clientName.slice(0, 2).toLocaleUpperCase(intl.locale)}
                </span>
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold">{grant.clientName}</p>
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
              </div>
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={busy}
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
