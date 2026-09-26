# Connect Microsoft 365 Copilot

Connect a Copilot Studio agent or a Microsoft 365 declarative agent to OpenLaw. Both use the **Microsoft 365 Copilot** registered client in OpenLaw. Each person signs in and chooses Toolsets and scope.

## Before you start

You need an OpenLaw account and permission to create an agent in the chosen Microsoft environment. An OpenLaw Administrator must [enable OAuth Clients for your account group](configure-mcp.md#enable-oauth-clients). The deployer must use the [publicly reachable profile](deployment-configuration.md#publicly-reachable). Microsoft tenant and data policies must allow the connection.

## Prepare the registered client

1. As an OpenLaw Administrator, open **Settings → Organization → MCP → Allowed Clients**.
2. Select **Edit** on **Microsoft 365 Copilot**, which has the **Registered client** pill.
3. Select **Generate secret**. In **Your Client secret is ready**, copy the secret and **Client id** into your approved secret store before selecting **Done**. OpenLaw cannot show the secret again.
4. Check that **Microsoft 365 Copilot** is still enabled in Allowed Clients. The seeded Clients start enabled.

If the row already has a secret, use the stored value. **Rotate secret** invalidates the old secret at once and leaves grants in place. Update every Microsoft connection using it after rotation.

Use these values in either Microsoft setup. Replace `https://legal.example.com` with the origin from your Server address. The discovery document at `https://legal.example.com/.well-known/oauth-authorization-server` also lists the endpoints and supported scopes.

| Field              | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| Server URL         | `https://legal.example.com/mcp`                       |
| Client ID          | The Client id from the OpenLaw dialog                 |
| Client secret      | The one-time secret from that dialog                  |
| Authorization URL  | `https://legal.example.com/api/auth/oauth2/authorize` |
| Token URL template | `https://legal.example.com/api/auth/oauth2/token`     |
| Refresh URL        | `https://legal.example.com/api/auth/oauth2/token`     |
| Scopes             | For example, `toolset:contracts offline_access`       |

Request only the Toolsets the people using the agent need. Scopes use `toolset:<id>`, such as `toolset:requests` for a Business User's Requests. Add `write` only if people need to consent to changes. `offline_access` allows token refresh until the grant expires. Guide needs no scope. OpenLaw does not offer `openid`, `profile` or `email` scopes for this connection. Keep PKCE enabled where Microsoft offers it.

## Use the Copilot Studio wizard

1. Open the agent's **Tools** page. Select **Add a tool → New tool → Model Context Protocol**.
2. Enter **Server name**, **Server description** and **Server URL** for OpenLaw.
3. Under authentication, select **OAuth 2.0**, then **Manual**. Enter the values above. Leave OpenLaw's **Dynamic client registration** off.
4. Select **Create**. Copy the callback or redirect URL shown by the wizard. Keep the wizard open.
5. In OpenLaw, select **Edit** on **Microsoft 365 Copilot** again. Under **Callback URLs**, paste that exact URL into the empty third slot. Leave the two fixed URLs unchanged. Select **Save**. Do this before starting sign-in.
6. Return to the wizard and select **Next**. In **Add tool**, select **Create a new connection**. Sign in and complete [Choose access on the consent page](#choose-access-on-the-consent-page).
7. Select **Add to agent**. Test by asking the agent to use OpenLaw to identify you and find this guide.

The callback belongs to your connection. Copy it from the wizard instead of guessing its host or path. See [Microsoft's MCP onboarding wizard](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent).

## Use a declarative agent

An agent builder uses Microsoft 365 Agents Toolkit to add an MCP plugin to a declarative agent. Supply OpenLaw's `/mcp` Server URL and the registered Client id, secret and scopes above when Toolkit asks for OAuth details. Toolkit reads the discovery endpoints and creates the authentication configuration in Microsoft's token store. Its plugin manifest uses `OAuthPluginVault` and the configuration ID. Keep the secret out of the manifest.

The OpenLaw template already includes the fixed Teams redirect:

```text
https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect
```

It also includes `https://vscode.dev/redirect` for Toolkit's Tool discovery. These first two callback slots are read-only. The Teams redirect is shared across declarative agents; it does not replace the Copilot Studio callback in the third slot.

Provision and test the agent using [Microsoft's OAuth setup](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-oauth). When Copilot asks you to connect, sign in to OpenLaw and follow the consent steps below. Microsoft 365 MCP plugins use OAuth and do not accept an OpenLaw API key. The admin-center BYO MCP registry is a separate path and is not covered by this guide.

## Resources and prompts

Microsoft documents [MCP tools and resources in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp), but does not list prompts as supported there.

## Choose access on the consent page

1. Sign in to your OpenLaw account if asked. A Business User uses Portal sign-in. Your usual password, magic link or SSO returns you to consent.
2. Check **Microsoft 365 Copilot wants to work in OpenLaw as you**, the organization, the identity caption and the **Allowed Client** pill. Check your name, account type and email.
3. Under **What Microsoft 365 Copilot may use**, select the Toolsets you need. **Nothing is selected for you.** The choices also depend on the scopes configured by the agent builder.
4. Under **How far Microsoft 365 Copilot may go**, choose **Read only** or **Read and write**. Read and write is offered only when requested and permitted by the organization. Changes are recorded as you, via Microsoft 365 Copilot.
5. Read **This Client can never see or change what you cannot.** Select **Allow** to return to Microsoft. Allow is disabled until a Toolset and scope are chosen. **Deny** refuses the connection.

## Disconnect or fix a connection

In OpenLaw, use **Settings → Personal → API keys → Connected Clients**. Business Users use **API keys → Connected Clients** in Portal Settings. The row shows Toolsets, scope, granted date and last use. Select **Disconnect**, then confirm **Revoke OAuth grant** with **Revoke**. The next call is refused; connecting again needs new consent.

If sign-in fails before consent, compare the wizard's redirect with the saved callback character for character. Check that the Client id and secret belong to the enabled registered client. If no Toolsets appear, check the configured scopes and the organization's Toolset ceiling. If the consent link expires, start again from Microsoft. See the [consent refusal messages](connect-claude.md#disconnect-or-fix-a-connection) for switches your Administrator can check.
