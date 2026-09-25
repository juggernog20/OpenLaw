# Configure MCP

Allow named Clients to work in OpenLaw for your people. An API key belongs to one person and cannot give the Client more record access than that person has.

You must be an Administrator. Open **Settings → Organization → MCP**, after Integrations and before Advanced. MCP and both account groups' API keys start off, including after an upgrade.

## Enable API keys

1. Turn on **Enable MCP**. The card changes to **MCP is on**.
2. Select **Copy address** beside **Server address**. Give this `/mcp` address to people connecting a Client.
3. Turn on **API keys** for **Legal Users**, which includes Administrators and Legal Team Members. Turn on the separate **Business Users** switch only if that group should connect Clients.
4. Expand **Toolset ceiling** and select the Toolsets the organization permits. A key request can narrow this set. Guide Tools are always available to an authenticated Client.
5. Turn on **Read-only** if no Client should make changes. It also blocks writes from an existing key with Write scope.
6. Under **API key lifetime**, set **API key lifetime (days)**, from 1 to 365. The default is 90. Leave the field or press Enter to save. The lifetime applies to new keys when approved.

Settings apply immediately and show **Settings saved.** Each Organization change is recorded in the Audit log. Turning MCP or a group's API keys off blocks that group's next Client request. Removing a Toolset from the ceiling blocks its Tools even on an existing key.

## Approve a request

People follow [Connect a headless Client](connect-headless-client.md) to submit a Client name, Toolsets, Read or Write scope, and an optional note.

1. Open the bell and find the API key request under **Your approvals**. Check the person, Client name, Toolsets, and scope.
2. Select **Approve** or **Deny**. You can also handle requests in the MCP section's **API key requests** card, with an optional note.
3. Tell the requester to return to their **API keys** pane. After approval, they can copy the key once from **Your key is ready**. The approval notification alone does not collect the key.

**Mark all read** leaves Your approvals in place. A handled request leaves the group. Administrators' own API key requests approve themselves, and their keys appear immediately in the once-shown dialog.

## Revoke and inspect activity

Expand **Active keys** to see the owner, Client, Toolsets, scope, last use, and expiry. Select **Revoke** and confirm to stop a key. Its next request is refused. People can also revoke their own keys from Personal Settings or Portal Settings. A lost or expired key needs a new request.

Select **Tool calls in the last day** to open **Audit log → Tool calls**. It lists the time, person, Client, Tool, outcome, and duration, with date filtering and export. It records reads as well as writes, without recording Tool arguments or results. Record activity and the Audit log also identify writes as the person, via the named Client, at the same visibility tier as the corresponding app action.

The calls-per-hour limit is in **Settings → Advanced → MCP rate limit**. It defaults to 600 per credential. Unlike MCP policy switches, an Advanced change requires the app and worker to restart. An environment-pinned value cannot be changed in Settings. A refused Client call names the limit and reset time.

## Use a private deployment

The [LAN only profile](deployment-configuration.md#lan-only) uses API keys on the office network or VPN. Give the Client device network access and certificate trust for the Server address. Enabling MCP does not make a private address public. This release supports API key connections; OAuth Clients and Allowed Clients are not part of these panes yet.
