# Configure MCP

Allow named Clients to work in OpenLaw for your people. An API key or OAuth grant belongs to one person and cannot give the Client more record access than that person has.

You must be an Administrator. Open **Settings → Organization → MCP**, after Integrations and before Advanced. MCP and both account groups' OAuth Clients and API keys start off, including after an upgrade.

## Enable API keys

1. Turn on **Enable MCP**. The card changes to **MCP is on**.
2. Select **Copy address** beside **Server address**. Give this `/mcp` address to people connecting a Client.
3. Turn on **API keys** for **Legal Users**, which includes Administrators and Legal Team Members. Turn on the separate **Business Users** switch only if that group should connect Clients.
4. Expand **Toolset ceiling** and select the Toolsets the organization permits. A key request can narrow this set. Guide Tools are always available to an authenticated Client.
5. Turn on **Read-only** if no Client should make changes. It also blocks writes from an existing key with Write scope.
6. Under **API key lifetime**, set **API key lifetime (days)**, from 1 to 365. The default is 90. Leave the field or press Enter to save. The lifetime applies to new keys when approved.

Settings apply immediately and show **Settings saved.** Each Organization change is recorded in the Audit log. Turning MCP or a group's API keys off blocks that group's next Client request. Removing a Toolset from the ceiling blocks its Tools even on an existing key.

## Choose Team and Administration

Expand **Toolset ceiling** to find these two rows. Both start unchecked on a new
installation and after an upgrade to M42. Select a checkbox to permit that Toolset.

| Row            | Id               | Caption                          | What it permits                                                              |
| -------------- | ---------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Team           | `team`           | Starts off.                      | Legal Users can add or remove people on Contract and Matter teams.           |
| Administration | `administration` | Starts off. Administrators only. | Administrators can read the Audit log, Tool calls and Organization settings. |

The Team Toolset has `openlaw_team_add` and `openlaw_team_remove`.
It requires Write scope and an organization that permits writes.
The same record access and team rules apply as in the app.
Removal is a destructive Tool. Change or clear the current Business Owner before removing that person.

The Administration Toolset has `openlaw_audit_log_query` and `openlaw_settings_get`.
Both are read Tools. The Audit log retains record access checks.
Settings use the same secret masking as the panes. No Tool changes settings.
Legal Team Members and Business Users cannot choose Administration.
Business Users cannot choose Team.

API key requests and OAuth consent share one rule for Toolset choices.
The Toolset must be in the ceiling and have at least one Tool the account type may run.
Empty Toolsets are not offered. OAuth consent also limits the choices to what the Client requested.
Nothing is pre-selected. Enabling a ceiling row does not add it to an existing key or grant.
The person must request a new key or give new consent for the added Toolset.

## Receive change notifications

A Client that supports the modern MCP listen stream can ask for change notifications.
When MCP switches, the Toolset ceiling or Read-only change, OpenLaw tells it to
reload its Tools, resources and prompts lists. The lists still follow the person's grant.

The Client can also subscribe to reached Contract, Matter, Request, Entity and
Knowledge Item resources. Legal Users can subscribe to the Inbox.
Updates contain the resource address, not its content. The Client reads it again.
Record access and Visibility tiers still apply. Document Version text, My Tasks
and vocabulary do not send resource updates.

Revoking a credential closes its stream. OpenLaw also checks expiry, account
changes and disabled access while a stream is open. A Client must reconnect after
a role change. These checks apply even if the Client has a cached list.
Older, legacy Clients reload by hand. Use the Client's refresh control or reconnect
after a change. Every call checks current access, so a stale list cannot retain removed access.

## Enable OAuth Clients

1. Turn on **Enable MCP** and set the **Toolset ceiling** and **Read-only** policy as above.
2. Turn on **OAuth Clients** for **Legal Users**, **Business Users**, or both. These switches are separate from **API keys**. Legal Users includes Administrators and Legal Team Members.
3. Check the pill beside **Server address**. **Reachable** means the address passed the three checks below. **Not reachable ·** names each failed check.
4. Expand **Allowed Clients**. The four seeded Clients start enabled. Disable the Clients people may not connect. Give people the Server address and the guide for [Claude](connect-claude.md), [ChatGPT](connect-chatgpt.md) or [Microsoft 365 Copilot](connect-microsoft-365-copilot.md).

| Failed check        | Meaning and action                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS scheme        | The Instance address uses HTTP. Use an HTTPS `BASE_URL`, or HTTP on a loopback host for development.                                                                               |
| IPv4 record         | The API could not resolve an IPv4 address. Check DNS and provide a public IPv4 record for hosted Clients. An IPv6-only hostname does not pass.                                     |
| Public IPv4 address | No IPv4 address was found, or at least one resolved address is private, loopback, link-local, shared or multicast/reserved in the check. Ask the deployer to check public routing. |

These are address and DNS checks from the API, cached for 30 seconds. **Reachable** does not test TLS certificate trust, the firewall or a vendor connection. Failed DNS or public-address checks warn but allow the switch to save, because a proxy may front the API. See the [publicly reachable deployment profile](deployment-configuration.md#publicly-reachable) for the paths exposed and network checks.

OAuth needs an HTTPS `BASE_URL`, or HTTP on `localhost`, `127.0.0.1` or `[::1]` for development. A plain-HTTP LAN address boots without the authorization server. API keys work, but the OAuth Clients switches refuse to turn on and the pill names the failed checks, including **HTTPS scheme**. The well-known documents return 404. Changing the Instance address needs an app and worker restart before retrying.

OAuth grants need no Administrator approval per person. The consent page lets the person narrow the requested Toolsets and choose Read only or Read and write. Turning MCP, a group's OAuth Clients or an Allowed Client off blocks its next request. The current ceiling and Read-only policy also apply to existing grants.

## Manage Allowed Clients

The card starts with Claude, Claude Code and ChatGPT as **Published identity** entries. Their captions show the vendor's metadata URL. They start enabled. You can disable and enable them. Their identities and callback URLs are not editable.

**Microsoft 365 Copilot** starts as a **Registered client** template. Select **Edit** to see **Client name**, **Client id** and **Callback URLs**. It has two fixed callbacks for Teams and Visual Studio Code, then an empty slot for the Copilot Studio wizard's consent redirect. Follow [Connect Microsoft 365 Copilot](connect-microsoft-365-copilot.md) to fill that slot.

1. For the template, select **Generate secret** in **Edit Client**. OpenLaw creates its Client id and secret.
2. In **Your Client secret is ready**, select **Copy** and retain the secret with its **Client id** in your approved secret store. Select **Done** only after saving it. OpenLaw will not show it again.
3. To change callbacks later, select **Edit**, paste exact URLs under **Callback URLs**, and select **Save**. **Add callback URL** adds another slot. Save callback edits before generating or rotating a secret, because those actions close the editor.
4. If the secret is lost or must change, select **Rotate secret**. The old secret stops working at once. Grants remain in place. Update every Client configuration that uses the secret.

For another registered client, select **Add Client**, enter **Client name** and at least one callback URL, then **Save**. In the editor, select **Generate secret** to open the same one-time secret dialog. A new Client starts enabled. Turn it off if it must not connect yet. **Delete Client** is available only for entries that were not seeded; deletion stops their access.

**Dynamic client registration** starts off. Leave it off for the three guides. The published identities and manually registered clients do not need it. Turning it on lets a Client register itself and adds an enabled registered client marked **Registered by the Client**. Turning it off closes registration and removes its endpoint from discovery, but does not remove entries already created. Disable those entries separately when needed. The protocol deprecates dynamic client registration.

## Approve a request

People follow [Connect a headless Client](connect-headless-client.md) to submit a Client name, Toolsets, Read or Write scope, and an optional note.

1. Open the bell and find the API key request under **Your approvals**. Check the person, Client name, Toolsets, and scope.
2. Select **Approve** or **Deny**. You can also handle requests in the MCP section's **API key requests** card, with an optional note.
3. Tell the requester to return to their **API keys** pane. After approval, they can copy the key once from **Your key is ready**. The approval notification alone does not collect the key.

**Mark all read** leaves Your approvals in place. A handled request leaves the group. Administrators' own API key requests approve themselves, and their keys appear immediately in the once-shown dialog.

## Revoke and inspect activity

Expand **Active keys and grants** to see the key and grant counts and the **Owner**, **Client**, **Toolsets**, **Scope**, **Status**, **Granted**, **Last used** and **Expires** columns. Select **Revoke** on a key or grant and confirm. An OAuth grant opens **Revoke OAuth grant**; select **Revoke** to stop it. Its next request is refused. People can revoke their own keys or select **Disconnect** in **Connected Clients** from Personal Settings or Portal Settings. A lost or expired key needs a new request. A revoked or expired grant needs new consent.

Select **Tool calls in the last day** to open **Audit log → Tool calls**. It lists the time, person, Client, Tool, outcome, and duration, with date filtering and export. It records reads as well as writes, without recording Tool arguments or results. Record activity and the Audit log also identify writes as the person, via the named Client, at the same visibility tier as the corresponding app action.

The calls-per-hour limit is in **Settings → Advanced → MCP**. It defaults to 600 per credential. Unlike MCP policy switches, an Advanced change requires the app and worker to restart. An environment-pinned value cannot be changed in Settings. A refused Client call names the limit and reset time.

**Settings → Advanced → MCP** also has **OAuth grant lifetime (days)**, from 1 to 365, with a default of 90. Save and restart app and worker to apply it. A deployment-pinned value is read-only. New grants use the active lifetime; existing grants keep their expiry. Refreshing a token does not extend that expiry.

## Use a private deployment

The [LAN only profile](deployment-configuration.md#lan-only) uses API keys on the office network or VPN. Give the Client device network access and certificate trust for the Server address. Enabling MCP does not make a private address public. Claude Code can also use loopback OAuth callbacks from that network when the authorization server is available. Hosted chat Clients need the publicly reachable profile.
