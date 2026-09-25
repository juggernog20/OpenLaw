# Connect ChatGPT

Connect ChatGPT to OpenLaw with OAuth. ChatGPT has no API key path for this connection. Each person signs in to OpenLaw and chooses what ChatGPT may use.

## Before you start

You need an OpenLaw account and a ChatGPT account with Developer mode available on the web. Your workspace may restrict it. Ask your Administrator to [enable MCP and OAuth Clients for your account group](configure-mcp.md#enable-oauth-clients), enable **ChatGPT** in **Allowed Clients**, and copy the **Server address**. The deployer must use the [publicly reachable profile](deployment-configuration.md#publicly-reachable).

## Add OpenLaw and scan its Tools

1. In ChatGPT, open **Settings → Security and login** and turn on **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins). Use the plus button to create a developer-mode app for OpenLaw.
3. Enter your Server address, including `/mcp`, such as `https://legal.example.com/mcp`. Select OAuth and the Client ID Metadata Documents option, CIMD. Leave static client credentials empty. OpenLaw recognizes ChatGPT's published identity, `https://chatgpt.com/oauth/client.json`.
4. Start the connection and complete the consent steps below when ChatGPT opens OpenLaw.
5. Let ChatGPT scan the Tools. Check the app's details for the returned list. It follows your account, selected Toolsets and scope. Each call also checks your record access. Refresh the app there after a change to the server's Tools or your access.
6. In a conversation, select **Developer mode** from the plus menu and choose OpenLaw. Ask: "Use OpenLaw to tell me who I am, then find and read the guide Connect ChatGPT."

See [ChatGPT's Developer mode instructions](https://developers.openai.com/api/docs/guides/developer-mode) for account availability and app controls. The app may appear under **Drafts** until your workspace publishes it. Review the Tools ChatGPT offers before using a write action.

## Choose access on the consent page

1. Sign in to OpenLaw with your usual account if asked. A Business User uses Portal sign-in. Password, magic-link and SSO sign-in return you to consent.
2. Check **ChatGPT wants to work in OpenLaw as you**, the organization, the Client identity and the **Allowed Client** pill. Check your name, account type and email.
3. Under **What ChatGPT may use**, select the Toolsets you need. **Nothing is selected for you.** Guide Tools remain available.
4. Under **How far ChatGPT may go**, choose **Read only** or **Read and write**. Read and write allows changes as you, recorded as you via ChatGPT. The organization can hide that choice with Read-only.
5. Read **This Client can never see or change what you cannot.** Select **Allow** to return to ChatGPT. It is disabled until a Toolset and scope are selected. Select **Deny** if you do not want to connect.

## Disconnect or fix a connection

Open **Settings → Personal → API keys → Connected Clients** in OpenLaw. Business Users use **API keys → Connected Clients** in Portal Settings. The card shows the Client, Toolsets, scope, granted date and last use. Select **Disconnect**, then confirm **Revoke OAuth grant** with **Revoke**. This stops the next call even if the app remains listed in ChatGPT.

If OpenLaw says **This consent request has expired or changed. Start again from your Client.**, restart the connection from ChatGPT. The link lasts ten minutes. If MCP, your account group's OAuth Clients, or ChatGPT's Allowed Client is off, ask the Administrator to check those switches. Other [consent refusals](connect-claude.md#disconnect-or-fix-a-connection) use the same messages.

If the Tool scan fails, check the public HTTPS address, discovery routes and firewall with the deployer. A successful sign-in in your own browser does not prove that ChatGPT can reach `/mcp`. Pasting an OpenLaw API key into ChatGPT does not fix the connection.
