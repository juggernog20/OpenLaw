# Configure MCP

Allow named Clients to work in OpenLaw for your people. An API key or OAuth grant belongs to one person and cannot give the Client more record access than that person has.

You must be an Administrator. Open **Settings → Organization → MCP**, after Integrations and before Advanced. Other roles do not see the Organization group. If a Legal Team Member opens the MCP address, OpenLaw sends them to their Profile. MCP and both account groups' OAuth Clients and API keys start off, including after an upgrade.

## Enable API keys

1. In the **MCP** card, turn on the switch beside **MCP is off**. The title changes to **MCP is on**.
2. Select **Copy address** beside **Server address**. Give this `/mcp` address to people connecting a Client.
3. In the **Legal Users** row, turn on the **API keys** switch. Legal Users includes Administrators and Legal Team Members. Turn on **API keys** in the **Business Users** row only if that group should connect Clients.
4. Expand **Toolset ceiling**. All 13 Toolsets start selected. Clear the Toolsets the organization does not permit. A key request can choose only from this set. Guide Tools are always available to an authenticated Client.
5. Turn on **Read-only** in the same card if no Client should make changes. It also blocks writes from an existing key with Write scope. The key request form then hides the Write choice.
6. Under **API key lifetime**, set **API key lifetime (days)**, from 1 to 365. The default is 90. Leave the field or press Enter to save. The lifetime applies to new keys when approved.

Each change saves at once and shows **Settings saved.** Each Organization change is recorded in the Audit log. Turning MCP or a group's API keys off blocks that group's next Client request. Removing a Toolset from the ceiling blocks its Tools even on an existing key.

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

1. Turn on MCP and set the **Toolset ceiling** and **Read-only** policy as above.
2. Turn on **OAuth Clients** in the **Legal Users** row, the **Business Users** row, or both. These switches are separate from **API keys**. Legal Users includes Administrators and Legal Team Members.
3. Check the pill beside **Server address**. It appears while an OAuth Clients switch is on. **Reachable** means the address passed the three checks below. **Not reachable ·** names each failed check.
4. In the **Allowed Clients** card, the four seeded Clients start enabled. Turn off the Clients people may not connect. Give people the Server address and the guide for [Claude](connect-claude.md), [ChatGPT](connect-chatgpt.md) or [Microsoft 365 Copilot](connect-microsoft-365-copilot.md).

| Failed check        | Meaning and action                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS scheme        | The Instance address uses HTTP. Use an HTTPS `BASE_URL`, or HTTP on a loopback host for development.                                                                                                       |
| IPv4 record         | The API could not resolve an IPv4 address. Check DNS and provide a public IPv4 record for hosted Clients. An IPv6-only hostname does not pass.                                                             |
| Public IPv4 address | No IPv4 address was found, or at least one resolved address is private, loopback, link-local, shared, in `0.0.0.0/8`, or 224 and above (multicast and reserved). Ask the deployer to check public routing. |

These are address and DNS checks from the API, cached for 30 seconds. **Reachable** does not test TLS certificate trust, the firewall or a vendor connection. Failed checks warn but let the switch save while the authorization server runs, because a proxy may front the API. See the [publicly reachable deployment profile](deployment-configuration.md#publicly-reachable) for the paths exposed and network checks.

OAuth needs an HTTPS `BASE_URL`, or HTTP on `localhost`, a `127.x.x.x` address or `[::1]` for development. A plain-HTTP LAN address boots without the authorization server. API keys work there. The OAuth Clients switches stay off, and the pill appears with the failed checks, including **HTTPS scheme**. **Add Client** and **Generate secret** also fail. The well-known documents return 404. Changing the Instance address needs an API and worker restart before retrying.

OAuth grants need no Administrator approval per person. The consent page lets the person choose from the requested Toolsets and pick **Read only** or, when requested and allowed, **Read and write**. Turning MCP, a group's OAuth Clients or an Allowed Client off blocks its next request. The current ceiling and Read-only policy also apply to existing grants.

## Manage Allowed Clients

The card starts with Claude, Claude Code and ChatGPT as **Published identity** entries. Their captions show the vendor's metadata URL. They start enabled. You can turn them off and on. Their identities and callback URLs are not editable.

**Microsoft 365 Copilot** starts as a **Registered client** template with the caption **No secret generated**. Select **Edit** to open **Edit Client** with **Client name**, **Client id** and **Callback URLs**. It has two fixed, read-only callbacks for Teams and Visual Studio Code, then an empty slot for the Copilot Studio wizard's consent redirect. Follow [Connect Microsoft 365 Copilot](connect-microsoft-365-copilot.md) to fill that slot.

1. For the template, select **Edit**, then **Generate secret**. OpenLaw creates its Client id and secret.
2. In **Your Client secret is ready**, select **Copy** and retain the secret with its **Client id** in your approved secret store. Select **Done** only after saving it. OpenLaw will not show it again.
3. To change callbacks later, select **Edit**, paste exact URLs under **Callback URLs**, and select **Save**. Use HTTPS, or HTTP only on a loopback host. **Add callback URL** adds another slot. Save callback edits before generating or rotating a secret, because those actions close the editor without saving.
4. If the secret is lost or must change, select **Edit**, then **Rotate secret**. The old secret stops working at once. Grants remain in place. Update every Client configuration that uses the secret.

For another registered client, select **Add Client**, enter **Client name** and at least one callback URL, then **Save**. The editor stays open as **Edit Client**. Select **Generate secret** to open the same one-time secret dialog. A new Client starts enabled. Turn it off if it must not connect yet. **Delete Client** is available only for entries that were not seeded. Deletion removes the entry and its grants, and stops their access.

**Dynamic client registration** starts off. Leave it off for the three guides. The published identities and manually registered clients do not need it. While it is on, a Client can register itself. Each registration adds an enabled registered client with the caption **Registered by the Client**. Turning it off refuses new registrations and removes the registration endpoint from discovery. It does not remove or turn off entries already created. Turn those off separately when needed. The protocol deprecates dynamic client registration.

## Approve a request

People follow [Connect a headless Client](connect-headless-client.md) to submit a Client name, Toolsets, Read or Write scope, and an optional note.

1. Open the bell and find the API key request under **Your approvals**. Check the person, Client name, Toolsets, and scope.
2. Select **Approve** or **Deny**. You can also handle requests in the **API key requests** card of the MCP section. The request's note shows under its Client name. There, **Approve** and **Deny** open a dialog with an optional **Note (Optional)**.
3. Tell the requester to return to their **API keys** pane. After approval, they can copy the key once from **Your key is ready**. The approval notification alone does not collect the key.

Approval checks the current policy. Approval fails if MCP or the group's API keys are now off, a Toolset is outside the ceiling, or the request asks for Write while **Read-only** is on. The card's dialog names the reason. The bell says **The request could not be handled. Try again.** Deny the request and ask for a new one.

**Mark all read** leaves Your approvals in place. A handled request leaves the group. Administrators' own API key requests approve themselves, and their keys appear immediately in the once-shown dialog.

## Revoke and inspect activity

Expand **Active keys and grants** to see the key and grant counts and the **Owner**, **Client**, **Toolsets**, **Scope**, **Status**, **Granted**, **Last used** and **Expires** columns. Select **Revoke** on a key or grant. A key opens **Revoke API key** and a grant opens **Revoke OAuth grant**. Select **Revoke** to stop it. Its next request is refused. People can revoke their own keys, or select **Disconnect** under **Connected Clients**, on their own **API keys** pane in Settings or the Portal. A lost or expired key needs a new request. A revoked or expired grant needs new consent.

Select **Tool calls in the last day** to open **Audit log → Tool calls**. It lists **When**, **Person**, **Client**, **Tool**, **Outcome** and **Duration**, with **From** and **To** date filters and **Export CSV**. It records reads as well as writes, without recording Tool arguments or results. Record activity and the Audit log also identify writes as the person, via the named Client, at the same visibility tier as the corresponding app action.

**Settings → Organization → Advanced → MCP** holds **Calls per hour per credential**. It defaults to 600. Unlike MCP policy switches, an Advanced change takes effect after the API and worker restart. A value set in the deployment configuration shows **Read only** and cannot be changed in Settings. A refused Client call names the limit and reset time.

The same page has **OAuth grant lifetime (days)**, from 1 to 365, with a default of 90. Save and restart the API and worker to apply it. New grants use the active lifetime; existing grants keep their expiry. Refreshing a token does not extend that expiry.

## Use a private deployment

The [LAN only profile](deployment-configuration.md#lan-only) uses API keys on the office network or VPN. Give the Client device network access and certificate trust for the Server address. Enabling MCP does not make a private address public. Claude Code can also use loopback OAuth callbacks from that network when the authorization server is available. The API must still reach `claude.ai` to fetch Claude Code's published identity. Hosted chat Clients need the publicly reachable profile.
