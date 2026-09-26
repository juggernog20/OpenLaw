# Connect Claude

Let Claude work in OpenLaw as you. You choose its Toolsets and scope on the consent page. It cannot gain access to records you cannot use yourself.

## Before you start

You need an OpenLaw account and the **Server address** from your Administrator, including `/mcp`. The Administrator copies it from **Settings → Organization → MCP**. Ask the Administrator to turn on MCP and [enable OAuth Clients for your account group](configure-mcp.md#enable-oauth-clients). The seeded **Allowed Clients** start enabled. Ask the Administrator to check that **Claude**, for claude.ai, Claude Desktop and Cowork, or **Claude Code**, for the command-line Client, is still enabled.

The custom connector needs the [publicly reachable deployment profile](deployment-configuration.md#publicly-reachable). Claude Code can also use a [LAN only deployment](deployment-configuration.md#lan-only) from the office network or VPN, if OpenLaw has a trusted private HTTPS address. A plain-HTTP LAN address has no OAuth. Your Claude plan and organization must permit custom connectors.

## Connect claude.ai, Claude Desktop or Cowork

1. In Claude, open **Customize → Connectors**. Select **Add**, then **Add custom connector**.
2. Enter a **Name**, such as `OpenLaw`. Enter OpenLaw's Server address as the **MCP server URL**, such as `https://legal.example.com/mcp`. Replace this example with your instance address. Select **Continue**.
3. Claude checks the server and detects how to sign in. Keep **Sign in now** and, under **OAuth client**, **Use Claude's published identity**. OpenLaw knows Claude by that identity, `https://claude.ai/oauth/mcp-oauth-client-metadata`. Your Administrator does not generate a Client ID or secret for it. Select **Add**.
4. Select **Connect** on the new connector's page. Complete [Choose access on the consent page](#choose-access-on-the-consent-page).
5. Enable OpenLaw for the conversation from **+ → Connectors**. Use the same remote connection in Claude Desktop or Cowork.

On Team and Enterprise plans, an Owner first adds the server through **Organization settings → Connectors → Add → Custom → Web**. Members then find it under **Customize → Connectors** and select **Connect** for their own accounts. See [Claude's custom connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Cowork and Claude Desktop can also use an API key through the `mcp-remote` bridge. Follow [Connect a headless Client](connect-headless-client.md#connect-claude-cowork-or-claude-desktop) for that path, including private deployments.

## Connect Claude Code

Replace the example with your Server address. Run:

```bash
claude mcp add --transport http --scope user openlaw https://legal.example.com/mcp
claude
```

Open `/mcp`, select `openlaw`, and follow its authentication prompt. Complete the consent steps below in the browser. Return to `/mcp` and check that `openlaw` is connected. User scope makes the connection available across your projects. See [Claude Code's MCP instructions](https://code.claude.com/docs/en/mcp).

Claude Code has its own published identity, `https://claude.ai/oauth/claude-code-client-metadata`. The browser returns to a loopback callback on your device, `http://localhost:<port>/callback` or `http://127.0.0.1:<port>/callback`. The browser and Claude Code must both reach OpenLaw and trust its certificate. On a private HTTPS address, give Claude Code the corporate CA as the [LAN only profile](deployment-configuration.md#lan-only) describes. The OpenLaw server must be able to fetch the published identity. No API key header or dynamic client registration is needed.

## Attach a record and run a prompt

In Claude Code, use the connection named `openlaw` from the steps above.
Type `@` to list resources, or enter a record address directly:

```text
Summarize @openlaw:openlaw://contracts/C-12
```

Replace `C-12` with a Contract you can open. The Contracts Toolset must be in
your grant. Claude Code reads the resource and adds its content to the conversation.
See the [address list](connect-headless-client.md#read-resources-and-get-prompts)
for Matters, Requests, Entities, Knowledge Items and Document Versions.
The resource keeps the same record access as the matching Tool.

Type `/` to find the two OpenLaw prompts. Run either command:

```text
/openlaw:triage_inbox
/openlaw:summarize_record openlaw://contracts/C-12
```

The triage prompt requires the Requests Toolset and a Legal User account.
It reads up to 25 Requests by default. Add a limit from 1 to 100 after the command
to change that number, such as `/openlaw:triage_inbox 10`.
It proposes a Disposition, type, urgency and assignee for each Request.
It asks for your confirmation before assignments or comments.
Those actions need the relevant Toolsets and Write scope.
For conversion, it gives you a link to the Request. Prepare any Conversion draft
and submit the Convert dialog in OpenLaw yourself.

The summary prompt needs one record address. Use a Contract, Matter, Request,
Entity or Knowledge Item that your grant and account can read.
It summarizes the embedded record and identifies missing information.
It does not change the record. Business Users can use it within their Portal access.
See [Claude Code's resources and prompts](https://code.claude.com/docs/en/mcp#use-mcp-resources).

In claude.ai, open **+ → Connectors** and the OpenLaw attachment menu.
The menu shows the resources and prompts available through your connection.
The views include Inbox, My Tasks and vocabulary when your grant permits them.
Individual records use addresses, so the menu is not a list of every record.
Choose a resource or prompt to add it to the conversation.
See the [MCP guide to remote connections](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-remote-servers).
If your Client does not show an item, use the matching Tool or the Claude Code steps above.

## Choose access on the consent page

1. Sign in to OpenLaw if asked. Use your usual password, magic link or SSO. If you use the Portal, select **Business Portal sign-in** on the sign-in page. Sign-in returns you to the consent page.
2. Check the organization, the Client's identity and the **Allowed Client** pill. The heading is **Claude wants to work in OpenLaw as you**, or **Claude Code wants to work in OpenLaw as you**. Below it, **Published identity** and the identity address name the Client. Check your name, account type and email.
3. Under **What Claude may use**, select the Toolsets you need. The label uses **Claude Code** for that Client. The page says **Nothing is selected for you.** Only the requested Toolsets your account and organization permit are offered. Guide Tools remain available and have no checkbox.
4. Under **How far Claude may go**, choose **Read only** or **Read and write**. The label again uses the actual Client name. Read and write allows changes as you and records each change as you, via the Client. It is offered only when the Client requests write access and the organization is not read-only.
5. Read **This Client can never see or change what you cannot.** Select **Allow** to return to the Client. Allow stays disabled until you choose at least one Toolset and a scope. Select **Deny** to refuse instead.

If you connect the same Client again, your new choices replace the earlier Toolsets and scope.

Ask: "Use OpenLaw to tell me who I am, then find and read the guide Connect Claude." The Client can call `openlaw_whoami`, `openlaw_docs_search` and `openlaw_docs_read`. Guide reads the same articles as Help.

## Disconnect or fix a connection

In OpenLaw, open **Settings → Personal → API keys** and find **Connected Clients**. Business Users select **Notification settings** in the Portal header, then **API keys**. Check the Client, Toolsets, **Read** or **Write** scope, granted date and last use. Select **Disconnect**, then confirm **Revoke OAuth grant** with **Revoke**. The row leaves the list. The Client's next call is refused. Connecting again needs new consent. If the Administrator turns off MCP, your account group's OAuth Clients or the Client, the Client's next call is also refused.

| What you see                                                                                       | What to do                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This consent request has expired or changed. Start again from your Client.                         | Start authentication again in Claude. The consent link lasts ten minutes. Do not reuse it.                                                                                               |
| MCP is off for this organization.                                                                  | Ask the Administrator to turn on MCP.                                                                                                                                                    |
| OAuth Clients are off for your account type.                                                       | Ask the Administrator to enable your account group's OAuth Clients.                                                                                                                      |
| This Client is not on the organization's Allowed Clients list.                                     | The Administrator removed the Client after you started. Ask the Administrator to check the Client identity.                                                                              |
| This Client is off in the organization's Allowed Clients list.                                     | The Administrator turned the Client off after you started. Ask whether this Client should be enabled.                                                                                    |
| No consent page, a timeout or a certificate error                                                  | Check the Server address and the deployment profile with the deployer. A custom connector connects from Anthropic's servers. Your device's VPN alone does not give those servers access. |
| Adding the connector shows **Couldn't reach this address** and **No server responded at this URL** | Check the Server address with the deployer. Claude's servers must reach it on the default HTTPS port, 443, with no port in the address.                                                  |
| No Toolsets to select                                                                              | Ask the Administrator to check the Toolset ceiling and the Client's requested scopes.                                                                                                    |

If OpenLaw shows **Client is not on the enabled Allowed Clients list.** before any sign-in page, the Client is off or missing in Allowed Clients. Ask the Administrator whether it should be enabled. A refused consent page offers **Deny** alone. An expired or altered request offers no actions. An expired grant needs a fresh connection and consent.
